# test/fixtures/security-runtime/ -- the TL4-009 security-runtime-gate fixture matrix

Zero-dep, SYNTHETIC fixtures for `build/flauz/scripts/security-runtime-gate.mjs`
(the runtime rung of the security gate; spec `docs/FLAUZ-PROGRAM/TL4-SECURITY-GATE.md`
section 7). Every advisory id here is synthetic (`GHSA-aaaa-...` shapes), every
package name is synthetic (`flauz-dep-*`, `flauz-gamma`, `flauz-omega`,
`shared-lib`, `upstream-only`), and every dist artifact is inert bytes -- nothing
here is a real credential, a real advisory, or executable code.

## Layout

| path | what it pins |
|---|---|
| `delta/product.json` + `delta/upstream.json` | the synthetic package.json pair: added (`flauz-dep-a@^1.2.3` dependencies, `flauz-dep-b@2.0.0` dependencies, `flauz-devtool-c@^0.9.0` devDependencies), unchanged (`shared-lib`, `shared-dev`), removed (`upstream-only`) -- the delta-computation contract |
| `audit/clean.json` | an npm-audit-shaped report with zero vulnerabilities (exit 0) |
| `audit/high-in-delta.json` | a HIGH advisory on `flauz-dep-a` (in the delta) -- exit 1 |
| `audit/critical-in-delta.json` | a CRITICAL advisory on `flauz-dep-b` (in the delta) -- exit 1 |
| `audit/moderate-in-delta.json` | a MODERATE advisory on `flauz-dep-a` (in the delta) -- exit 0 (below the HIGH/CRITICAL bar, reported not verdicts) |
| `audit/outside-delta.json` | a CRITICAL advisory on `shared-lib` (upstream-shared, NOT in the delta) -- exit 0 (advisories outside the delta are never verdicts) |
| `audit/allowlisted.json` + `audit/audit-allowlist.json` | a HIGH advisory on `flauz-devtool-c` + a matching adjudicated allowlist entry -- exit 0, reported as suppressed, entry consumed (1/1) |
| `audit/audit-allowlist.json` vs `audit/clean.json` | the same allowlist entry against a report with no matching advisory -- exit 1 (unused-entry hygiene, the secrets-allowlist precedent) |
| `sbom/extensions/` | two synthetic flauz extension manifests (`flauz-gamma@3.1.4`, `flauz-omega@0.2.0`) |
| `sbom/expected-sbom.json` | GATE-GENERATED (via `--sbom-out`): the exact CycloneDX 1.5 document the gate emits for the synthetic tree + delta pair (5 components) |
| `sbom/missing-extension.json` | expected minus the `flauz-omega` component -- exit 1 (extension coverage) |
| `sbom/invalid.json` | a structurally invalid document (missing specVersion/version/components) -- exit 1 |
| `sbom/drifted.json` | expected with `flauz-omega` bumped to 0.3.0 -- exit 1 (drift vs the fresh emission, the pinning law) |
| `manifest/extensions/` | two synthetic flauz extensions with `dist/extension.bundle` artifacts (inert bytes; the `.bundle` extension keeps these out of the javascript-file hygiene ledger -- they are hash-pinning test data, never executed). NOTE: the repo-wide `.gitignore` line `dist` swallows every `dist/` directory (build outputs); these two fixture files are tracked via `git add -f` -- safe by construction because `pinned-match.json` pins their exact sha256, so any tampering, deletion, or rot fails the `runtime manifest match PASS` case immediately (the fixture is self-guarding) |
| `manifest/pinned-match.json` | GATE-GENERATED (fixture `--generate`): correct sha256 pins for the synthetic dists -- exit 0 |
| `manifest/pinned-drift.json` | pinned-match with one hash hex doctored -- exit 1 (tamper signal) |
| `manifest/pinned-incomplete.json` | pinned-match minus the `flauz-omega` pin -- exit 1 (unpinned extension) |

## Fixture mode (how the rows run offline)

The fixture flags point single rows at synthetic inputs (they REQUIRE `--row`,
so they can never leak into a full repo run):

```
node build/flauz/scripts/security-runtime-gate.mjs --row audit \
  --audit-json test/fixtures/security-runtime/audit/high-in-delta.json \
  --package-json test/fixtures/security-runtime/delta/product.json \
  --upstream-package-json test/fixtures/security-runtime/delta/upstream.json
```

- The audit row then consumes the captured report file (no npm spawn, no
  network, no installed tree).
- The sbom row consumes `--extensions-root` + the delta pair and either emits
  (`--sbom-out`) or verifies (`--verify-sbom`) a document.
- The manifest row consumes `--extensions-root` + `--manifest` and compares
  hashes WITHOUT re-bundling (the fixture proves the drift-compare core; the
  repo-mode row re-bundles via the repo's own esbuild -- the exact mechanism
  of the frozen gate's packaging row, which the double-bundle reproducibility
  proof already covers).

The delta-pair fixtures deliberately use names that cannot collide with the
committed `package-lock.json`, so the lockfile version-resolution fallback
(declared range + `flauz:declared-range`) is exercised deterministically.

All of it is pinned in `build/flauz/scripts/verify-fixtures.sh` (the
security-runtime section). The repo-mode cases there (skip-vs-fail shapes) run
only where the tree is NOT installed; post-install contexts (the integration
station, CI job 2) run the real rows.
