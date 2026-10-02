# Flauz Release

Install/update reliability + the release checklist (A-PROD-004-W5, the
beta-readiness FINAL wave; TL-A product completion lane). When this wave
lands, the A-PROD-004 beta gate is CLOSED: all ten capabilities delivered.

Landed waves this extension binds: W1 diagnostics + support/debug bundle
(`flauz-diagnostics`, PR #128), W2 durable-state backup/export + crash
recovery (`flauz-backup`, PR #133), W3 workspace migration/upgrade safety +
rollback (`flauz-migration`, PR #134), W4 telemetry with explicit privacy
controls + provider/environment failure handling (`flauz-telemetry`, PR
#135). This extension's own foundation reuse: the install verification's
integrity class reuses the W2 export/verify machinery (a fresh self-export
verifies; cross-recognizable with flauz-backup in both directions), the
update check reuses the W3 plan grammar (identity/transform/refusal) and
the torn-migration signals, the checklist consults the W1 census + the W4
opt-in state and failure taxonomy — all through contract-duplicated shapes
(the DL-32 law; never imported across extension boundaries from src),
pinned against the real owning modules by `test/contract.test.ts`.

## The product laws (this extension's surface)

1. **The metadata law.** Install/update verification and the release
   checklist legitimately enumerate surface SHAPES — paths, versions,
   checksums, verdicts, counts — and NEVER CONTENTS. Every metadata surface
   (the verification record, the checklist artifact, the banked rows, every
   command render) is swept for secret-shaped values before a single byte
   is written (fail-closed). The one content-carrying artifact is the fresh
   self-export's `state/` copy (the W2 machinery, byte-identical by
   construction — a backup's job, exempt by the W2 split-sided law).
2. **The never-updates law.** `flauz.release.updateCheck` NEVER performs
   the update. It reads, classifies, and refuses. The migration itself
   stays in flauz-migration's hands (the boundary law); this gate is the
   operator's pre-flight only. It writes nothing: no plan, no anchor, no
   marker.
3. **The go/no-go law.** `flauz.release.checklist` returns GO only when
   ALL TEN rows are green; any red/unknown row = NO-GO with the exact
   failing row. The `unknown` verdict class exists because a check that
   cannot resolve is not green (a corrupt telemetry config means the
   opt-in state cannot be known; a workspace without a repo-state product
   means the install verification cannot run — this wave's evidence law).
4. **The evidence law.** The install verification runs against the
   REPO-STATE PRODUCT: the `extensions/flauz-*` manifests, the
   packaging-parity registry and the SBOM. A workspace that carries none
   of these gets the typed `FLAUZ_RELEASE_NO_PRODUCT_STATE` refusal — the
   runtime-installed-product angle is A-PROD-005's production-readiness
   lane, reported as residue, never improvised here.

## Commands

- `flauz.release.verify` — the install/update reliability plane: verifies
  the installed product state end-to-end over five check classes, each
  with the typed verdict vocabulary (green/tampered/torn):
  - **extensions** — the extension census: every packaged extension
    present (each surface the registries name has a live, parseable
    manifest — a missing/unparseable one is a TORN install) and
    activation-lint clean (the command-only activation rules mirrored
    from `build/flauz/scripts/activation-lint.mjs` R1–R3 plus the
    built-in id and entrypoint laws — a violation is TAMPERED);
  - **parity** — the packaging-parity contract (rows vs manifests, the
    PP2 coverage + PP4 posture re-derivation semantics): a live manifest
    without rows or a posture row that no longer re-derives is TAMPERED
    (drift); rows citing a vanished surface are TORN (the incomplete
    install reading);
  - **sbom** — the SBOM component coverage: every live extension has a
    component row, every component has a manifest, and the dependency
    graph covers every component;
  - **census** — the durable-state surfaces readable (the W1 census runs
    clean: every present row parse-clean, absence honest — a parse error
    is TORN);
  - **integrity** — the W2 verify machinery applied to the CURRENT state:
    the current chain verdicts + a FRESH self-export that must verify
    (a truncated tail is torn, a broken chain is tampered; the export of
    a chain-broken workspace is still a green EXPORT — the W2 law — so
    the current chains are folded in).
  Persists `.flauz/release/verify-<stamp>.json`
  (`flauz.release-verify/v1`) — swept, census-visible (the banked evidence
  row with taskId `flauz-release`), the watermark re-synced so every
  post-verification integrity verdict stays GREEN.
- `flauz.release.updateCheck` — the pre-update gate: censuses the current
  state, reads the CURRENT per-surface format versions (the W3 version
  inventory), and reports the readiness matrix — `identity` (already at
  the registry's expected version), `transform` (a bridging transform
  exists; the production transform registry is EMPTY at this base — the
  honest W3 scope, so a mismatch is a refusal in the shipped product),
  `refusal` (unrecognized/torn/mixed version, or no bridge — the exact
  surface named), `absent` (honest). Plus the anchor dry-run (the W2
  machinery, dry: enumerates exactly what an anchor would copy, lists the
  existing anchors, refuses over a torn state). A torn migration state
  refuses the whole gate (recovery is `flauz.migration.rollback`, never a
  blind continue).
- `flauz.release.checklist` — the one-command go/no-go that binds ALL TEN
  beta capabilities, every row carrying its evidence pointer (the owning
  command + the observable):

  | row | check | evidence command |
  |---|---|---|
  | 1 | diagnostics census clean | `flauz.diag.show` |
  | 2 | backup/export verified (a fresh self-export verifies green) | `flauz.backup.export` + `flauz.backup.verify` |
  | 3 | crash-recovery readiness (the verify-first restore drill over the fresh export: restorable surfaces + consent requirement) | `flauz.backup.restore` |
  | 4 | migration plan path clear (zero refusal surfaces, anchor feasible) | `flauz.migration.plan` |
  | 5 | telemetry config resolvable (the opt-in state known: absent = default-off, parsed = enabled/disabled, corrupt = UNKNOWN) | `flauz.telemetry.config` |
  | 6 | provider/env failure typing loaded (the 14-class taxonomy closed over the real source vocabularies) | `flauz.failures.list` |
  | 7 | rollback anchor available (the newest export verifies; the anchor dry-run is feasible) | `flauz.migration.execute` + `flauz.backup.verify` |
  | 8 | support/debug bundle generatable (every bundle input class resolves over the current state) | `flauz.diag.bundle` |
  | 9 | install verification green (all five check classes) | `flauz.release.verify` |
  | 10 | the checklist artifact persisted + re-readable (its checklistId re-derives) | `flauz.release.checklist` |

  The artifact — `.flauz/release/checklist-<stamp>.json`
  (`flauz.release-checklist/v1`) — is the release record the operator
  signs off (the beta gate's closure evidence): the full verdict table,
  every row's evidence pointer and details, `checklistId = sha256` over
  the canonical body minus the id, persisted + re-read + re-derived before
  row 10 turns green (the prediction is verified, never assumed),
  census-visible banked, watermark re-synced.

## The consulted surfaces (local-real, read-only)

Everything this extension consults is read through contract-duplicated
shapes (the DL-32 law; pinned by `test/contract.test.ts`): the W1 census
(`flauz-diagnostics`), the W2 export/verify machinery (`flauz-backup` —
cross-recognizable in both directions), the W3 version inventory + torn
signals (`flauz-migration`), the W4 telemetry config state + failure
taxonomy (`flauz-telemetry`), and the repo-state product surfaces
(`extensions/flauz-*/package.json`,
`build/flauz/packaging-parity.json`, `build/flauz/security/flauz-sbom.json`).

## Census visibility (the W1 diagnosability)

Every verification record and checklist artifact banks an evidence-ledger
note row (taskId `flauz-release`, uri = the artifact path, sha256 = the
artifact bytes) and re-syncs the size watermark — so the NEXT diagnostics
census genuinely reports the release activity (rowCount + 1,
kindCounts.note + 1, a new chain head), and every post-banking integrity
verdict stays GREEN.

## Architecture

`src/` is node-free except `extension.ts` (the wiring row: the node
`ReleaseFsPort` over `node:fs/promises`, the output channel, the workspace
root, the repo-state product probe, the live versions block). Every
effect is a port (`ReleaseFsPort` / `Clock` / `OutputChannelPort` /
`VersionsInfo` / the product root) — the flauz-migration /
flauz-telemetry wiring-row precedent, mirrored by the packaging-parity
triad rows this wave adds (posture / core / wiring, additive only).

## Evidence level

**local-real**: the real durable-state formats, the real census/verify/
plan machinery (contract-duplicated, pinned byte-equal against the owning
modules), the real workspace layout (fixture workspaces booted by driving
the REAL owning services), and the real repo-state product (the live
`extensions/flauz-*` + `build/flauz/*` tree — the strongest receipt: the
extension verifies its own product state green). No runtime-real claim: no
live install target is exercised by this wave (the runtime-installed-
product angle is A-PROD-005's production-readiness lane).

## Development

```sh
npm run typecheck        # tsc --noEmit (the src-only program)
npm run typecheck-tests  # tsc --noEmit -p tsconfig.test.json (src + suite)
npm test                 # mocha --ui tdd test/*.test.ts
```

The isolated runner recipe (no repo-root install needed):

```sh
mkdir -p /tmp/labrun && cd /tmp/labrun && npm init -y >/dev/null && \
  npm i --silent --no-audit --no-fund mocha tsx
cd <repo-root>/extensions/flauz-release
NODE_OPTIONS="--import file:///tmp/labrun/node_modules/tsx/dist/loader.mjs" \
  /tmp/labrun/node_modules/.bin/mocha --ui tdd test/*.test.ts
```
