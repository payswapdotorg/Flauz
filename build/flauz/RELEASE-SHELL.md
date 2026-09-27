# Flauz Release Shell — TL1-002 Runbook

Ownership: TL1-002 (product build/release shell). This is the runbook for the
product shell: the overlay, its gate, the CI build path, artifact expectations,
version stamping, and the honest list of what is not wired yet.

Related documents: `build/flauz/README.md` (harness overview + Appendix Lane F —
the overlay's key-by-key rationale), `build/flauz/SYNC-RUNBOOK.md` (upstream
sync), `build/flauz/merge-product.mjs` (the merge tool), `product.flauz.json`
(the overlay itself).

---

## 1. The product shell, in one paragraph

Flauz does not fork `product.json`. The upstream `product.json` stays
byte-identical to the preserved reference line (`upstream/main` @
`9bf9ae764da` — enforced by `compat-battery.mjs` L2 identity rows), and the
Flauz product identity is an **overlay** (`product.flauz.json`, repo root)
merged on top at build time by `build/flauz/merge-product.mjs` with
**null-deletes** semantics (DL-16): an explicit JSON `null` deletes a key,
plain objects merge recursively, arrays and scalars replace wholesale. The
merged product — what a Flauz build would ship — is what
`build/flauz/scripts/verify-product.mjs` asserts on.

## 2. Overlay completion checklist (what a change to the product shell must do)

1. **Audit the manifests.** For every `extensions/flauz-*/package.json` that
   declares non-empty `enabledApiProposals`, the overlay's
   `extensionEnabledApiProposals` must force-enable EXACTLY that set under the
   `"<publisher>.<name>"` key — the product list REPLACES the manifest
   declaration (`src/vs/workbench/services/extensions/common/extensionsProposedApi.ts:80-102`),
   and a declared-but-uncovered proposal is the runtime "WILL BE BROKEN" error
   (`:91-97`). Extensions with empty lists get NO entry, with the one
   documented exception: the DL-4 default-participant grant for
   `flauz.flauz-agent` (`["defaultChatParticipant", "chatParticipantAdditions"]` —
   `chatParticipant.contribution.ts:268-276`; `canaries/default-agent-checklist.md` D2).
   Current audited state: `flauz-browser [browser]`,
   `flauz-workspace [scmArtifactProvider]`, `flauz-agent []` + the documented
   grant; environments/models/resources/workflow declare nothing and get
   nothing.
2. **Proposals must exist.** Unknown proposal names are silently DROPPED at
   runtime (`extensionsProposedApi.ts:46-52`). The gate cross-checks every
   granted name against the registry
   (`src/vs/platform/extensions/common/extensionsApiProposals.ts`).
3. **Identity rebrand.** `nameShort`/`nameLong` are "Flauz"; every
   identity-bearing scalar whose base value names a Microsoft/VS Code product
   is rebranded (the full current set: `applicationName` `flauz`,
   `dataFolderName` `.flauz`, `sharedDataFolderName` `.flauz-shared`,
   `win32MutexName` `flauz`, `win32DirName`/`win32NameVersion` `Flauz`,
   `win32RegValueName` `Flauz`, `win32AppUserModelId` `Flauz.Flauz`,
   `win32ShellNameShort` `Flauz`, `win32TunnelServiceMutex`
   `flauz-tunnelservice`, `win32TunnelMutex` `flauz-tunnel`,
   `serverApplicationName` `flauz-server`, `serverDataFolderName`
   `.flauz-server`, `tunnelApplicationName` `flauz-tunnel`,
   `darwinBundleIdentifier` `flauz.flauz`, `linuxDesktopName` `flauz.flauz`,
   `linuxIconName` `flauz`, `urlProtocol` `flauz`, `reportIssueUrl`
   `https://github.com/payswapdotorg/Flauz/issues/new`).
4. **Copilot removal.** `defaultChatAgent: null` (the DL-16 null-delete),
   `builtInExtensionsEnabledWithAutoUpdates: []` (**value replacement, never
   null** — see the trap in §6), `trustedExtensionAuthAccess` surgical
   null-deletes of the `github`/`github-enterprise` copilot-chat grants (the
   `microsoft` → `vscode.github-authentication` grant stays: functional
   in-tree wiring).
5. **Unknown keys are omitted, not guessed (DL-17).** The merger warns on any
   overlay key without an `IProductConfiguration` consumer at the pinned base;
   the gate surfaces the same as a WARN row. Do not add speculative keys.
6. **Update the schema + validation if the surface grows.**
   `build/flauz/product.flauz.schema.json` describes every overlay key;
   `merge-product.mjs` `KNOWN_OVERLAY_KEYS` + `validateOverlay` validate them
   (the null-delete trap for `builtInExtensionsEnabledWithAutoUpdates` is
   encoded there on purpose). Keep both in sync with the overlay.
7. **Extension inclusion needs nothing in the overlay.** Bundling is driven by
   build config, not a product key (see §4) — set NOTHING and document instead.
8. **Run the gates** (§3) and extend the fixtures when a rule changes
   (`test/fixtures/product-shell/` + `verify-product.test.mjs` +
   `verify-fixtures.sh` — every rule needs a case that makes it FAIL).

## 3. The verify-product gate

```
node build/flauz/scripts/verify-product.mjs --root . --require
```

Zero-dep (node >= 20 stdlib), wired into `flauz-hygiene.yml` as a sibling of
the guard/activation-lint/ia-gate/premium-ux-gate steps (fail-fast, before any
install). Exit codes: 0 clean/SKIP · 1 violation · 2 usage. Flags: `--root
<dir>` (runs on fixture trees), `--require` (flips documented SKIPs to
failures), `--no-fail` (report-only), `--json` (machine-readable), `--help`.

Rules on the MERGED product (produced via the `mergeProduct` API):

| Rule | Asserts |
|---|---|
| PS1 | both files strict-parse; `validateOverlay` passes; unknown overlay keys WARN (DL-17) |
| PS2 | `nameShort`/`nameLong` === "Flauz"; runtime-enumerated branding sweep over every scalar key of base ∪ overlay (deny patterns: microsoft / visual studio / vscode / code-oss / oss / copilot) with the four documented exemptions (`licenseUrl`, `serverLicenseUrl` — MIT attribution; `webviewContentExternalBaseUrlTemplate` — commit-pinned webview CDN; `voiceWsUrl` — voice service endpoint, Pillar 1) |
| PS3 | `defaultChatAgent` absent; `builtInExtensionsEnabledWithAutoUpdates` present (scanner safety, §6) and Copilot-free; `trustedExtensionAuthAccess` grant lists Copilot-free |
| PS4 | manifest-declared proposals force-enabled EXACTLY; no undeclared grants beyond the documented DL-4 table; no stale `flauz.*` entries; every granted proposal exists in the registry |
| PS5 | the REAL inclusion mechanisms: manifest + `src/extension.ts` present for every flauz dir; `main` is `./dist/extension.js` or absent; no flauz name in merged `builtInExtensions`/`webBuiltInExtensions`; no flauz name in `build/lib/extensions.ts` `excludedExtensions` |

Fixture matrix: `test/fixtures/product-shell/` (18 trees; every rule has a
FAIL case), wired into `verify-fixtures.sh` and driven content-level by
`node --test build/flauz/verify-product.test.mjs` (24 tests).

Division of labor with the compat battery: `compat-battery.mjs` L2 diffs
**contribution surfaces** product-vs-upstream (its product-identity rows bless
product.json changes that stay inside the overlay's key set —
`runLayer2ProductIdentity`); `verify-product.mjs` verifies the **merged
product posture**. They cite each other; neither subsumes the other.

## 4. The CI build path (what compiles, what packages)

What exists today, all on GitHub Actions:

| Pipeline | Workflow | What it proves |
|---|---|---|
| Compile + hygiene | `flauz-hygiene.yml` → `hygiene` job → "Compile & Hygiene" step (`npm exec -- npm-run-all2 -l core-ci hygiene eslint valid-layers-check define-class-fields-check vscode-dts-compile-check tsec-compile-check`, shaped on upstream `.github/workflows/pr.yml`) | the tree compiles and passes upstream hygiene, with the merged-product posture gated fail-fast before any install (the verify-product step) |
| Extension bundles | `flauz-hygiene.yml` unit-subset step + `flauz-security.yml` → `packaging-reproducibility` job | flauz extensions bundle via the repo's own esbuild (`bundle-extensions.mjs`) and the dist is byte-identical across double bundles |
| Runtime posture evidence | `flauz-session.yml`, `flauz-browser.yml`, `flauz-compat.yml`, `flauz-budgets.yml`, `flauz-workflow.yml`, `flauz-rota.yml`, `flauz-perf.yml`, `flauz-canaries.yml` | whole-session acceptance, browser/runtime gates, upstream-compat battery, budgets |

**What does NOT exist: a packaged-artifact job.** No CI workflow today runs the
upstream product-packaging pipeline (the `vscode-darwin-*`/`vscode-linux-*`/
`vscode-win32-*` gulp task family in `build/gulpfile.vscode.ts` that consumes
`.build/extensions` and stamps the packaged `product.json`). Stated plainly:
no workflow produces a shippable desktop installer/server archive, so the
"clean Flauz build output" acceptance is proven at the level the worker can
prove — the MERGED product posture + the inclusion mechanisms — and the
packaged-build acceptance is CI's/the Lead's to verify when a
packaged-artifact job lands (see §7). The upstream pipelines that WOULD pull
GitHub Copilot into `.build/extensions` (`build/azure-pipelines/common/downloadCopilotVsix.ts`)
are not run by Flauz CI; when a Flauz packaging job is built it must
deliberately skip that step and use the local-source path instead.

Where extension inclusion actually lives (the DL-17 finding): upstream
packaging globs `extensions/*/package.json` and excludes the hardcoded
`excludedExtensions` list and any name listed in `product.json`
`builtInExtensions` (`build/lib/extensions.ts:413-427`, `:318-326`, `:425`);
the Flauz bundling step discovers `extensions/flauz-*/src/extension.ts` and
esbuilds each to `dist/extension.js` (`build/flauz/scripts/bundle-extensions.mjs`).
No product key controls inclusion — hence nothing in the overlay, and PS5
asserts these mechanisms directly.

## 5. Artifact inventory expectations (when a packaging job exists)

A Flauz packaged build is expected to contain, per platform:

- the merged `product.json` (overlay applied — identity "Flauz", no
  `defaultChatAgent`, no copilot residue; version/date/commit/checksums
  stamped by the build, see §6);
- all in-tree built-in extensions under `extensions/` (the debugger trio via
  `builtInExtensions` marketplace fetch at BUILD time — Pillar 1 capability)
  including **all seven** `flauz-*` extensions with their `dist/extension.js`
  bundles (via `bundle-extensions.mjs`, byte-identical per the
  `flauz-security.yml` packaging-reproducibility job);
- **no** GitHub Copilot extension (the VSIX-download pipeline step is upstream
  Azure-Pipelines-only and must stay out of the Flauz packaging job);
- no marketplace gallery in the product config (the base ships without one —
  the documented Lane F deviation).

The machine-checkable stand-ins today: `verify-product.mjs` (posture),
`bundle-extensions.mjs --verify` (dist presence after a build),
`security-gate.mjs` packaging row (reproducible bundles).

## 6. Version stamping (DL-18) reconciliation

The overlay carries `"version": "0.1.0"`, but `build/gulpfile.vscode.ts` stamps
`json.version` at packaging time from the ROOT `package.json` version (+ a
quality suffix when set) — `build/gulpfile.vscode.ts:176-205`, the overwrite
at `:205` — and the runtime falls back to the package.json-derived value when
the key is absent (`src/vs/platform/product/common/product.ts:53-60`). The
root `package.json` version is currently `1.140.0` (the upstream Code OSS
line).

Consequences, stated plainly:

- In packaged builds the overlay's version is **silently replaced** — it is
  advisory pre-packaging only. This is the recorded DL-18 conflict.
- Reconciliation protocol for the packaging lane (when it lands): either
  (a) stamp the Flauz release version into the root `package.json` (the
  upstream-native path — the overlay version then mirrors it as documentation),
  or (b) add a build step that rewrites the overlay version from the release
  manifest before merging. Until then, the honest statement is: **the shipped
  version of a Flauz build is whatever the root package.json says**, and the
  overlay version is a v0 work-order artifact kept for schema completeness.

## 7. Not wired yet (honest list)

1. **No packaged-artifact CI job** — nothing produces an installer/server
   archive; the packaged-build acceptance ("clean build output") is unproven
   until one exists (§4). This is the top follow-up.
2. **DL-18 version reconciliation** is documented (§6), not automated.
3. **Windows/macOS installer identity**: `win32x64AppId`/`win32arm64AppId`/
   `win32x64UserAppId`/`win32arm64UserAppId` still carry the base GUIDs and
   `darwinProfileUUID`/`darwinProfilePayloadUUID` the base UUIDs — inert for
   unsigned OSS-class builds, but a Flauz-owned set (new GUIDs, a controlled
   reverse-DNS domain for `darwinBundleIdentifier`) is required the moment
   signed packaging lands. The PS2 sweep passes them because GUID/UUID values
   name nothing; re-owning them is a deliberate packaging-lane decision, not a
   branding leak.
4. **D5/D6 runtime verifications** from the default-agent canary
   (`chatIsEnabled` without setup agents; status-bar entry lifecycle) remain
   VERIFY-IN-CI on a real boot — Worker G / CI scope.
5. **D10/D11 re-branding debt**: hard-coded "Copilot"/GitHub literals in core
   strings and telemetry-only assumptions survive the product-config-level
   removal (documented inventories in `canaries/default-agent-checklist.md`).
6. **Gallery posture**: no `extensionsGallery` (base posture preserved). A
   future gallery decision must re-audit canary D4 first.
7. **onboardingKeymaps** keeps the "VS Code" keymap label — it names the de
   facto keymap style (like "Vim"/"IntelliJ"), which is accurate for a
   Code OSS derivative; revisit only with a deliberate UX decision.

## 8. Quick reference

```sh
# the gate (CI shape)
node build/flauz/scripts/verify-product.mjs --root . --require

# merged product sanity (stdout)
node build/flauz/merge-product.mjs --out - | head -30

# the fixture matrix (all cases, expects each outcome)
sh build/flauz/scripts/verify-fixtures.sh

# content-level suite
node --test build/flauz/verify-product.test.mjs
node --test build/flauz/merge-product.test.mjs
```
