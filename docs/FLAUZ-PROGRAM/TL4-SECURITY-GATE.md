# TL4-006 — Integrated Security + Release Gates

Status: fixture rung delivered (this document is the binding spec).
Owner: TL4 (product-quality lane). Gate: `build/flauz/scripts/security-gate.mjs`.
CI: `.github/workflows/flauz-security.yml` (job 1 zero-dep static rows; job 2
full `--require` after the root install).

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
- **runtime rung (follow-up)**: post-npm-install supply-chain checks
  (`npm audit` on the flauz delta), bundle signature verification against
  a pinned release manifest, and an SBOM emission for the flauz artifacts.
  These need release engineering decisions (where artifacts are published,
  which signer identity) that belong to the release-approval flow — the
  gate's row catalogue reserves room (additive rows, never silent edits).
