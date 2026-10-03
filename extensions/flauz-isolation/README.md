# flauz-isolation — the data-isolation plane (A-PROD-005-W3)

The wave the W1 production gate's `dataIsolation` NOT-YET row names: the
**workspace-boundary enforcement** — the boundary audit, the enforcement
verdict, and the read-only state view.

## The command surface (command-only activation: `onCommand:flauz.isolation.*`)

| Command | What it does |
|---|---|
| `flauz.isolation.audit` | The boundary audit: enumerates **every persistent surface the product writes** (the `.flauz/` tree: the evidence ledger, the telemetry state + records, the production census/matrix/gate records, the backup recovery log + exports, the migration state, the integrity ledger/verify records + the port-owned key store, the memory tiers + watermarks, and every other durable surface) — each discovered through the **REAL product registry surfaces** (the `extensions/flauz-*` manifests + the packaging-parity registry + the SBOM components: the census derivation, **never a hardcoded list that can drift**) and classified against the isolation law: **workspace-bound** (the default: the record's lifetime is the workspace's, it never leaves the tree) / **workspace-exportable** (the operator-initiated export surfaces: the W2 backup export, the release self-export, the diagnostics bundle — the typed allowlist) / **port-owned** (the integrity key store: sealed to the port's own path law). A registry-grown extension or a `.flauz/` surface class the law does not know = typed **UNKNOWN** (fail-closed disclosure, never a guessed verdict). A record found OUTSIDE its lawful boundary (a stamp-shaped record file, an `export-<stamp>/` or `support-bundle-<stamp>/` directory outside its lawful home, a nested `.flauz/`/`.flauz-exports/` tree, a symlink leaking the boundary) = typed **BOUNDARY_VIOLATION** with the exact path. Persists `.flauz/isolation/audit-<stamp>.json` (`flauz-isolation-audit/v1`), swept fail-closed, banked census-visible (evidence-ledger note row, taskId `flauz-isolation`). |
| `flauz.isolation.enforce` | The enforcement verdict for the CURRENT workspace — six typed checks: the **cross-workspace census** (how many `.flauz/` trees are reachable from this workspace root: exactly ONE by law; multiple = typed violation with the paths), the **export-dir shape** (exports live ONLY in `.flauz-exports/` — the real product's exports dir, DELIBERATELY outside `.flauz/` per the W2 anti-recursion law; an export-shaped directory anywhere else, including inside `.flauz/`, is a typed violation), the **telemetry local-only law** (the W4 plane's state exists only at its lawful workspace-local paths; a violated one-tree census degrades the containment checks to `unknown` — never a silent green), the **memory-tier containment**, the **migration-state containment**, the **banked-record taskId law** (every banked evidence-ledger row names its owning extension — anonymous rows = typed violation, torn rows = typed unknown). The typed verdict table per check: `green / violation / unknown / absent` (absent surfaces degrade typed, never a silent green). Persists `.flauz/isolation/enforce-<stamp>.json` (`flauz-isolation-enforce/v1`), swept + banked. |
| `flauz.isolation.status` | The read-only state view: the audit's surface-classification summary + the last enforcement verdict. **No state change** — nothing written, nothing banked (proven by the write-refusing fs port in the suite). |

## The honest-boundary disclosure

The **workspace is the isolatable unit this product owns**. The boundary
laws are enforced within the workspace root's reachable tree (the disclosed
skip law: `.git` + `node_modules` are host/tooling trees, never scanned).
OS-level sandboxing, containerization and multi-tenant **host** isolation
are the HOST's posture, outside this plane's jurisdiction — disclosed,
never claimed. Evidence level: **local-real** (the real product registry as
the audit's subject; fixture workspaces with real `.flauz/` trees; planted
violations walked by the real boundary scan). Never claim runtime-real for
multi-tenant host isolation.

## The order-vs-repo boundary note

The work order names the export law as "exports live ONLY in
`.flauz/exports/`" — the REAL product law (flauz-backup, A-PROD-005-W2) is
`.flauz-exports/` at the workspace root, **DELIBERATELY outside `.flauz/`
so an export never recurses into itself**. This extension enforces the
real law (the order's own derivation law demands the real registry
surfaces); the wording discrepancy is disclosed in the wave report.

## The STATION-PENDING doctrine

This extension **never regenerates** `build/flauz/security/bundle-manifest.json`.
The CI packaging-reproducibility bundle-manifest row **fails by design** on
worker branches (the pin is minted at the integration station at landing;
this wave's own pin lands there). The wave's two disclosed additive
shared-file edits: the packaging-parity triad rows (59 → 62) and the SBOM
component row (17 → 18, instrument-regenerated). The flauz-production
gate's `dataIsolation` row flip + the `CAPABILITY_CATALOG` growth are the
TL's station work at landing (the boundary law: this wave never touches
flauz-production's src).

## The suite (mocha tdd)

`audit` (the classification round-trip over the real-shaped registry; the
UNKNOWN classes — registry-grown extension, unclaimed `.flauz/` entry; the
BOUNDARY_VIOLATION classes — the planted out-of-tree artifact, the nested
tree, the stray export, the symlink leak; presence honesty; persistence +
banking; determinism) · `enforce` (the one-tree law, the multi-tree
violation, the export-dir shape, the anonymous-banked-row violation, the
absent-surface degradations, the containment unknowns, the never-silent-
green law; persistence + banking; determinism) · `status` (the read-only
law proven with a write-refusing fs port) · `contract` (the DL-32 pins:
the law table's paths byte-equal against the REAL owning modules; the
census-id pin; the sha256/canonicalJson/ledger-row pins; the REAL registry
derivation — every extension known, station-stable) · `privacy` (the
canary sweep + the port-owned-surface boundary).

The isolated-runner recipe (no repo install):

```sh
mkdir -p /tmp/labrun && cd /tmp/labrun && npm init -y >/dev/null && \
  npm i --silent --no-audit --no-fund mocha tsx @types/mocha
cd <repo-root>/extensions/flauz-isolation
NODE_PATH=/tmp/labrun/node_modules \
  NODE_OPTIONS="--import file:///tmp/labrun/node_modules/tsx/dist/loader.mjs" \
  /tmp/labrun/node_modules/.bin/mocha --ui tdd test/*.test.ts
```

(The `@types/mocha` install + a gitignored `node_modules` symlink into the
extension dir — the `.gitignore` line 5 pattern — is what makes
`npm run typecheck-tests` resolve the mocha types in a pre-install tree; the
repo-root install carries them at the station.)
