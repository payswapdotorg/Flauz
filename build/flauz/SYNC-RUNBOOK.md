# Flauz upstream-sync runbook (TL1-001)

The repeatable procedure for absorbing the preserved Code OSS reference line
(`upstream/main` @ `9bf9ae764da438b1234a8243dc9e47173ef58ee7` at the program
reset) into the canonical product line (`main`), without losing Flauz
additions and with every merge conflict and decision recorded.

Owner: TL1. cadence per DL-11: divergence 0 → monthly; > 0 → weekly.

Tooling (this directory):

- `scripts/sync-upstream.mjs --report` — the delta census (also committed as
  `build/flauz/UPSTREAM-DELTA.md`; exit 1 on shared-file divergence outside
  the allowlist, exit 0 under `--no-fail`).
- `scripts/sync-upstream.mjs --plan` — the dry-run plan: ahead/behind,
  `git merge-tree` conflict detection with both-sides classification, canary
  trigger list, checkpoint tag name, DECISION-LOG reminder.

Both are zero-dependency (node >= 20 stdlib only). Never `npm install` to run
them. All commands run from the repo root.

## 1. Pre-flight (before touching main)

```sh
# 1a. the FORK-CRITICAL gate (src/vs pristine outside contrib/flauz)
sh build/flauz/scripts/fork-critical-guard.sh --base upstream/main --head HEAD

# 1b. the delta census — is a sync even pending? (behind > 0 means yes)
node build/flauz/scripts/sync-upstream.mjs --report --base upstream/main

# 1c. the sync plan — conflicts are DATA: read them BEFORE merging
node build/flauz/scripts/sync-upstream.mjs --plan
```

Expect 1a to exit 0 (it is the gate; the report only re-derives its
assertion). Expect 1b to exit 0 while the only shared-file changes are the
allowlisted intentional ones (`build/flauz/sync-allowlist.json`); exit 1 means
either an unallowlisted shared-file change crept onto the product line, a
path landed outside the flauz-owned additive namespace, or `behind > 0`
upstream paths are unabsorbed — investigate before proceeding, and if the
divergence is intentional, record it in the allowlist (with reason and date)
in the same change.

If `behind == 0` there is nothing to absorb: stop after step 1, the sync is a
no-op.

## 2. The sync itself — MERGE upstream/main INTO main, never rebase

```sh
git checkout main
git pull --ff-only            # start from the integrated head
git merge --no-ff upstream/main -m "chore(tl1): upstream sync — merge upstream/main into main (<date>, TL1-001 runbook)"
```

Hard rules:

- **MERGE, never rebase product history.** The product line's commit history
  is shared across four TL lanes and external clones; rebasing rewrites it.
- `--no-ff` keeps the sync as an explicit merge commit (rollback unit, see
  §5).
- Never commit to `upstream/main` — it is the READ-ONLY reference line.
  Product work lives only in `extensions/flauz-*`, `build/flauz/`,
  `test/fixtures/`, `product.flauz.json`, `.github/workflows/flauz-*` (plus
  the allowlisted shared-file integration points and the program documents).

## 3. Conflict-resolution policy

The `--plan` output already classified every conflict path. Resolve by class:

1. **Flauz-owned additive paths** (`extensions/flauz-*`, `build/flauz/`,
   `test/fixtures/`, `.github/workflows/flauz-*`, program docs) — these can
   only conflict if two Flauz lanes touched the same new file; auto-resolve
   is expected (`git checkout --ours` is wrong here — take the side that
   matches the lane's intent, usually the union). Record the resolution in
   the merge commit message.
2. **Any shared upstream file** (anything that exists on `upstream/main`) —
   **escalate to the TL with both sides recorded**. Do not resolve silently:

   ```sh
   git show :2:<path>   > /tmp/<path>.flauz-side     # ours   (product line)
   git show :3:<path>   > /tmp/<path>.upstream-side  # theirs (reference line)
   git show :1:<path>   > /tmp/<path>.base            # merge-base
   ```

   The decision template (attach to the checkpoint tag / work-registry
   entry): path, flauz-side change, upstream-side change, resolution, why,
   rollback. The default bias: keep upstream's version and re-apply the
   Flauz delta as an additive change, or demote the Flauz change to an
   additive path (ARCHITECTURE-LOCK §4). Any resolution that keeps a src/vs
   patch requires a FORK-CRITICAL ledger entry + DECISION-LOG record — the
   guard will fail the build otherwise.

3. After resolving, re-run the pre-flight gates before committing the merge.

## 4. Post-sync gates (the merge is not done until these pass)

```sh
# 4a. the FORK-CRITICAL guard against the NEW head
sh build/flauz/scripts/fork-critical-guard.sh --base upstream/main --head HEAD

# 4b. canaries C-20/23/24/28 (build/flauz/README.md job 4 — at EVERY sync, DL-11)
#     via .github/workflows/flauz-canaries.yml jobs:
#       c20-default-agent, c23-parallel-sessions, c24-subagents-steering, c28-browser-tools
#     (workflow_dispatch the workflow on the merge commit and require all four green)

# 4c. proposed-API rota snapshot — commit the new baseline at the tag
node build/flauz/scripts/proposed-api-rota.mjs --repo-root . \
  --snapshot build/flauz/rota-baseline.json

# 4d. checkpoint tag (build/flauz/README.md job 6)
git tag flauz/sync/$(date -u +%Y-%m-%d)

# 4e. DECISION-LOG diff since the previous checkpoint tag
#     (MIGRATION-PLAN §5 job 6; DECISION-LOG.md not yet on main at the TL1-001
#     landing — record sync decisions in docs/FLAUZ-PROGRAM/WORK-REGISTRY.md
#     under the TL1-001 entry until it lands)
git diff --stat flauz/sync/<previous-date>..flauz/sync/<date> -- DECISION-LOG.md

# 4f. regenerate the committed delta report and commit it on main
node build/flauz/scripts/sync-upstream.mjs --report --out build/flauz/UPSTREAM-DELTA.md
git add build/flauz/UPSTREAM-DELTA.md && git commit -m "docs(flauz): refresh UPSTREAM-DELTA.md at flauz/sync/<date>"

# 4g. push main and the tag; confirm flauz-hygiene (incl. the upstream-sync
#     report job), flauz-canaries and flauz-rota are green on the merge commit
```

## 5. Rollback

The sync is exactly one merge commit (`--no-ff` guaranteed it):

```sh
git checkout main
git revert -m 1 <merge-commit-sha>     # creates the inverse commit; no history rewrite
git push origin main
# delete the checkpoint tag only if it pointed at the reverted merge:
git tag -d flauz/sync/<date> && git push origin :refs/tags/flauz/sync/<date>
```

Never `git reset --hard` a pushed main — other lanes build on it.

## 6. What this runbook does NOT yet automate (honest list)

1. **The merge itself is manual.** `sync-upstream.mjs --plan` detects
   conflicts (content-level, via `git merge-tree --write-tree`, git >= 2.38;
   older gits degrade to both-sides-touched candidates) but performs no
   resolution and creates no merge. A future TL1 item may wrap §2-§4 into a
   single supervised command once the conflict-escalation protocol has run at
   least once against real upstream movement.
2. **Canary execution is CI-side.** The runbook points at the four canary
   jobs; it does not run them locally (MIGRATION-PLAN §5 — worker sandboxes
   never build the IDE).
3. **The DECISION-LOG diff** (4e) is a reminder line, not a gate —
   DECISION-LOG.md is not on main at the TL1-001 landing; the reminder notes
   this and falls back to the work registry.
4. **The allowlist is manual.** `build/flauz/sync-allowlist.json` records the
   intentional shared-file divergences (.eslint-allowed-javascript-files,
   AGENTS.md at landing); nothing detects that a NEW shared-file change
   *deserves* allowlisting — the report fails and a human decides.
5. **Upstream tag/release notes** are not captured — the census is
   file-level; summarizing WHAT upstream shipped (feature notes, semver
   drift) is not implemented.
6. **The flauz/main compatibility alias** is reported (lag note in
   UPSTREAM-DELTA.md) but not repointed by any automated step.
7. **CI artifact upload** (`flauz-hygiene.yml` job `upstream-sync`) runs with
   `--no-fail` by design — it is the always-green evidence stream; the
   fail-fast enforcement stays with the pre-flight gates in this runbook.
