# TL4-006 — Integrated Security + Release Gates

Status: fixture rung delivered + runtime rung delivered (this document is the
binding spec).
Owner: TL4 (product-quality lane). Gates: `build/flauz/scripts/security-gate.mjs`
(fixture/static rung) and `build/flauz/scripts/security-runtime-gate.mjs`
(runtime rung, TL4-009).
CI: `.github/workflows/flauz-security.yml` (job 1 zero-dep static rows; job 2
full `--require` after the root install + the runtime rows; job 3 the
`workflow_dispatch` runtime report).

## 1. The quality question

Flauz ships as an additive product on top of Code OSS. Its release-blocking
security surface was scattered: secret hygiene was a manual discipline,
supply-chain purity was implicit, the proposed-API permissions rota was its
own script, packaging reproducibility was unproven. TL4-006 integrates all
of it into ONE machine-checked verdict that fails loudly — on every
Flauz-relevant change.

## 2. The rows

| row | what it checks | verdict semantics |
| --- | --- | --- |
| secrets | credential-pattern scan over the Flauz additive namespace (extensions/flauz-\*/{src,test,shims}, build/flauz, test/fixtures, docs/FLAUZ-PROGRAM, src/vs/workbench/contrib/flauz, product.flauz.json): GitHub token family, OpenRouter, Neon, AWS AKIA, private-key blocks, JWTs, Composio, credential-carrying connection strings, generic secret assignments (with an obvious-placeholder filter) | any finding = FAIL (named file:line + pattern) |
| allowlist-hygiene | the intentional-divergence allowlist (build/flauz/security-allowlist.json — same discipline as compat-allowlist) must have every entry CONSUMED; an unused entry is fixture drift | unused entry = FAIL |
| dependency-purity | supply chain: every extensions/flauz-\*/package.json declares ZERO runtime `dependencies`; `devDependencies` limited to the allowlist (typescript) | any problem = FAIL |
| proposed-api | permissions surface: composes proposed-api-rota.mjs (assert mode) — proposed-API drift between the flauz union and the upstream d.ts/registry | rota drift = FAIL |
| packaging | reproducible release artifacts: composes bundle-extensions.mjs — esbuild every flauz extension TWICE with the repo's own esbuild, hash all dist artifacts, assert byte-identical; then `--verify` every flauz main exists | non-identical / verify miss = FAIL; SKIPs when esbuild is unresolvable (pre-install lanes) — `--require` promotes SKIP to FAIL |

### Delegated dynamic rows (documented, never faked)

- **DL-20 hardened-ledger integrity** (signing: tamper detection,
  wrong-key rejection, truncated-tail detection) — pinned by
  `extensions/flauz-workflow/test/hardening.test.ts`, runs in
  `flauz-workflow.yml` (both push and PR).
- **Browser safety** (deny-by-default policy engine, per-session hardening,
  popup gate, credential isolation, fail-closed journal) — pinned by the
  `flauz-browser.yml` node --test suites (156+ cases) and the
  session-battery's J3 fail-closed journey (`flauz-session.yml`).

This gate composes the STATIC release surface; those lanes own the dynamic
one. The integration contract: a Flauz release is green when ALL of
flauz-security, flauz-workflow, flauz-browser, flauz-session (+ the hygiene/
compat/budget lines) are green on the same head.

## 3. The allowlist

`build/flauz/security-allowlist.json` — `flauz.security-allowlist/v0`,
entries `{file, pattern, reason}`. Entries must name a REAL match (the
allowlist-hygiene row fails on unused entries). Current entries: the
DL-20 hardened-ledger ed25519 fixture key pair (a generated test pair,
consumed by hardening.test.ts). Adding an entry requires a reason that
would survive audit.

## 4. Fixture discipline

`test/fixtures/security-gate/`:

- `clean/` — placeholder assignments never fire (the false-positive guard).
- `planted-github|planted-neon|planted-connstring|planted-key/` — one
  SYNTHETIC credential per pattern; each must FAIL the gate (exit 1) with
  the pattern named. (The planted values are synthetic — fixture-shaped
  tokens, never real credentials. The gate's own planted fixtures are
  excluded from the repo-mode scan: they are the gate's test data.)
- `allowlist-case/` — a planted key + a documented allowlist entry:
  suppression must PASS; the same tree without the allowlist FAILS (proven
  by planted-key).

`verify-fixtures.sh` pins all of it (104-case matrix as of this delivery).

## 5. CI wiring

Job 1 (zero-dep, node 20, no install): static rows + the fixture matrix.
Job 2 (root install, per .nvmrc): the FULL gate with `--require` — the
packaging row must bundle twice and prove byte-identical artifacts.

## 6. Promotion ladder

- **fixture/static rung (shipped)**: everything above.
- **runtime rung (shipped, TL4-009)**: section 7 below.

## 7. The runtime rung (TL4-009)

Gate: `build/flauz/scripts/security-runtime-gate.mjs` — a SIBLING gate
(zero-dep, node >= 20 stdlib). The row law holds: rows are additive, and the
TL4-006 gate above stays frozen; nothing in this rung edits an existing row.

| row | what it checks | verdict semantics |
| --- | --- | --- |
| audit-delta | post-install supply-chain audit: `npm audit --json` over the installed root tree, filtered to the FLAUZ-ADDED dependency delta (deps/devDeps present in the product root `package.json` but absent in `upstream/main`'s, computed via git plumbing over the ref chain `upstream/main` -> `origin/upstream/main`) | any HIGH/CRITICAL advisory inside the delta = FAIL; advisories outside the delta are reported, never verdicts; SKIPs when no installed tree exists, `--require` promotes |
| sbom | CycloneDX 1.5 JSON SBOM for the Flauz artifact set (every `extensions/flauz-*` manifest + the flauz-added root dependency delta, versions resolved from the committed `package-lock.json` where readable), emitted by a zero-dep hand-rolled generator; deterministic (content-derived serial number, no wall-clock fields) | self-check (parse-back + required fields + extension coverage) FAILs on structural invalidity or a missing extension; default posture verifies the committed `build/flauz/security/flauz-sbom.json` — ANY drift = FAIL; `--sbom-out <path>` is the emit/regeneration posture |
| bundle-manifest | pinned sha256 manifest of the reproducible flauz extension bundles (`build/flauz/security/bundle-manifest.json`): verify mode re-bundles with the repo's own esbuild (the exact packaging-row mechanism) and compares every dist artifact hash | ANY drift (hash, artifact set, version, unpinned extension) = exit 1 — the supply-chain tamper signal; `--generate` pins from a fresh double-bundle run; SKIPs when esbuild is unresolvable (packaging-row SKIP semantics), `--require` promotes |

### 7.1 The audit scope decision (documented)

`npm audit --json` runs over the FULL tree (production + dev) — flauz-added
devDependencies are product supply chain too (they execute in CI) — with
verdicts scoped to the delta. The delta is name-level: version-range changes
of upstream-shared deps stay upstream's posture. The allowlist
`build/flauz/security/audit-allowlist.json` (schema
`flauz.audit-allowlist/v0`) is BORN EMPTY; an entry suppresses exactly one
advisory for one package with a reason that would survive audit, and the
hygiene rule mirrors the secrets allowlist: whenever the row produces a
report, an entry matching no advisory is fixture drift (FAIL).

### 7.2 The pinning law

Two artifacts are pinned by COMMITTING them and failing on drift:
`flauz-sbom.json` and `bundle-manifest.json`. Regeneration (SBOM:
`--sbom-out build/flauz/security/flauz-sbom.json`; manifest: `--generate`) is
an explicit action, never a silent side effect of a gate run, and EVERY
regeneration lands as a PR-reviewed diff — the SBOM diff shows exactly which
components entered/left the artifact set, the manifest diff shows exactly
which bundle hashes changed (each must trace to a reviewed source change).
Consequence: any PR that changes bundle bytes (extension source, bundler
flags, esbuild version) or the artifact set (new extension, dependency-delta
change, upstream ref move) must regenerate the pins in the same PR — CI job 2
re-derives both artifacts on every run and fails on any divergence.

The bundle manifest ships STATION-PENDING when the bundler cannot run where
the work landed (worker sandboxes never install at the repo root,
MIGRATION-PLAN section 5): the integration station runs `--generate`
post-install and commits the pins in the same PR. A STATION-PENDING manifest
FAILs the verify row wherever the row can actually run (not-pinned is
divergence), and SKIPs (promoted under `--require`) where esbuild is absent.

### 7.3 Skip-vs-fail policy

- audit-delta: SKIP (exit 0) when no installed tree exists; FAIL under
  `--require`. CI job 2 runs it post-install (live).
- sbom: runs anywhere zero-dep (needs the upstream ref for the delta — the
  CI steps fetch `origin/upstream/main` for the shallow checkout); drift
  against the committed pin is always FAIL.
- bundle-manifest: follows the packaging row — SKIP when esbuild is
  unresolvable, promoted under `--require`; CI job 2 enforces post-install.

### 7.4 CI wiring

Job 2 (post-install) gains two steps after the frozen `--require` step: the
runtime gate with `--require` (audit live, sbom + manifest verify), and the
SBOM drift check (regenerate + `diff -u` vs committed). Job 3
(`security-runtime-report`, `workflow_dispatch` only) runs the gate with
`--json --out`, uploads the report + the committed SBOM as artifacts
(informational; enforcement stays with job 2). Fixture changes gate via the
added `test/fixtures/security-runtime/**` trigger path.

### 7.5 Fixtures

`test/fixtures/security-runtime/` (all SYNTHETIC: `GHSA-aaaa-...` advisory
ids, synthetic package names, inert `.bundle` dist bytes — never executed,
kept out of the javascript-file hygiene ledger): the delta pair
(added/unchanged/removed), six audit-report cases + the allowlist pair
(clean, high/critical-in-delta FAIL, moderate-in-delta + outside-delta
informational PASS, allowlisted suppression, unused-entry hygiene), four
SBOM documents (valid/missing-extension/invalid/drifted) + the emit
determinism byte-match, three manifest cases (match/drift/unpinned), usage
contracts, and the repo-mode skip-vs-fail shapes. Pinned in
`verify-fixtures.sh` (27 cases; 132 total).

### 7.6 Honest residue (release-engineering decisions that remain open)

Per section 6's original note, these belong to the release-approval flow,
not to this gate: (a) SIGNING IDENTITY — the manifest pins content hashes
(byte integrity) but nothing yet signs the manifest itself (who signs, with
what key, where the public key is published); (b) PUBLISH LOCATION — where
the pinned bundles + SBOM are published for consumers to verify against;
(c) audit false-positives policy — the allowlist is the escape hatch, but
adjudication ownership (who may land an entry) is unwritten. Until those
land, the runtime rung proves integrity and provenance of the artifacts IN
REPO, which is the boundary of what a repo-resident gate can prove.
