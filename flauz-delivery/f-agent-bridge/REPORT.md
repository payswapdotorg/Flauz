# Wave 3 Lane F — Agent Bridge + Own Chat Participant (PRODUCT CODE)

- **Worker**: flauz-F-w3 (rebuild after the 2026-09-25 platform re-image; see
  `/home/z/my-project/worklog.md` W3-F-recovery for the loss audit)
- **Repo**: `github.com/payswapdotorg/Flauz` clone @
  `9bf9ae764da438b1234a8243dc9e47173ef58ee7` (verified), branch
  `flauz/wave3/agent-bridge`
- **Posture**: additive only — `git diff --name-status 9bf9ae764da..HEAD` =
  **56 A / 0 M / 0 D** (FORK-CRITICAL ledger stays empty, DL-12)
- **This staging**: repo-relative copies of the full delta + `MANIFEST.txt`
  (sha256 per file) + this REPORT + `README.md`

## WHAT-BUILT

| Area | Files | Content |
|---|---|---|
| `extensions/flauz-agent/` | 26 | `flauz.agent` chat participant (DL-3), `flauz_terminal` tool with HumanApproval gate, golden-path orchestrator, model selection w/ vendor preference, artifacts, stdio seam client, zero-dep `core/service.mjs` (G side), pure `core/contracts.mjs` (9 legal transitions, canonical JSON, row hash, ledger verify), vendored `vscode.d.ts`, ambient shims, 26 tests incl. full golden-path end-to-end against the real spawned service |
| `extensions/flauz-models/` | 19 | `flauz-mock` deterministic streaming echo provider on the stable `LanguageModelChatProvider` API, `languageModelChatProviders` contribution + lazy `onLanguageModelChatProvider:flauz-mock` activation, frozen design-only vendor stubs (flauz-codex/flauz-claude/flauz-qwen) with pricing envelopes shaped after the vendored proposed `languageModelPricing` d.ts (NOT enabled, DL-4), vendored d.ts pair, 12 tests |
| `build/flauz/` | 6 | `merge-product.mjs` (strict-JSON recursive merge, NULL-DELETES semantics, known-key validation, unknown-key warnings, TAB-indent output), `product.flauz.schema.json`, 5 merger tests, `canaries/default-agent-checklist.md` (U-1/C-20 closure spec, D1–D11), `README.md`, `stage-delivery.mjs` (this staging) |
| `product.flauz.json` | 1 | v0 overlay (see PRODUCT-KEYS) |

Golden path (verified by `test/goldenPath.test.ts`): request → createTask →
submit-plan(agent) → **approve(human)** → `flauz_terminal` invocation
(confirmation asked; `echo flauz-golden-path-ok` via shell-integration
exec, mocked terminal in tests) → evidence rows (command-output +
changeset/checkpoint) → report(agent) → verify-pass(**tool**) →
**sign-off(human)** → done; ledger hash-chain verified; artifacts on disk.

## VERIFICATION-RECEIPTS

All commands run in this sandbox (Node v24.21.0, tsc 5.9.3 from the host
toolchain — the only dev-dependency, never installed in-tree):

```
$ /home/z/my-project/node_modules/.bin/tsc --noEmit -p extensions/flauz-agent/tsconfig.json   -> exit 0
$ /home/z/my-project/node_modules/.bin/tsc --noEmit -p extensions/flauz-models/tsconfig.json  -> exit 0
$ node --test <flauz-agent test/*.test.ts>   -> 26 tests, 26 pass, 0 fail
    (contracts 6, seamClient 3, smokeRun 1, models 2, terminalTool 4,
     participant 2, goldenPath 5, extension 3)
$ node --test <flauz-models test/*.test.ts>  -> 12 tests, 12 pass, 0 fail
    (extension 3, mockProvider 6, vendors 3)
$ node --test build/flauz/merge-product.test.mjs -> 5 tests, 5 pass, 0 fail
$ node build/flauz/merge-product.mjs --base product.json --overlay product.flauz.json --out - -> exit 0
    spot-check: nameShort/nameLong "Flauz", version "0.1.0", NO defaultChatAgent,
    extensionEnabledApiProposals {flauz.flauz-agent: [defaultChatParticipant,
    chatParticipantAdditions]}, base keys otherwise preserved (47 top-level keys)
$ git diff --name-status 9bf9ae764da..HEAD  -> 56 A / 0 M / 0 D  (FORK-CRITICAL clean)
$ git status                                -> clean
$ git bundle verify wave3-f-agent-bridge.bundle -> ok (prerequisite 9bf9ae764da present)
```

The golden-path test prints a full milestone trace (task ids, statuses,
evidence ids, checkpoint refs, ledger verdicts) and asserts the on-disk
state: `.flauz/tasks.json` event trail with per-event actors, the
hash-chained `.flauz/evidence/ledger.jsonl` (row 2 `prev` = recomputed
`rowHash(row 1)`), and the artifact bytes under
`.flauz/artifacts/T-001/command-output-1.txt`.

## PRODUCT-KEYS

`product.flauz.json` (merged over the upstream `product.json` by
`build/flauz/merge-product.mjs`):

| Key | Value | In-tree evidence | Rationale |
|---|---|---|---|
| `nameShort` | `"Flauz"` | real key (product.json:2; IProductConfiguration product.ts) | identity rebrand |
| `nameLong` | `"Flauz"` | real key (product.json:3) | identity rebrand |
| `version` | `"0.1.0"` | NOT a real product.json key — stamped at build from package.json (gulpfile.vscode.ts:198-205) | included per work-order v0 spec; **DL-18**: CI must reconcile the stamping conflict |
| `identifier` | (omitted) | no such key in IProductConfiguration, zero consumers (W3-F-r1 grep) | **DL-17**: dropped from the overlay spec |
| `extensionEnabledApiProposals` | `{"flauz.flauz-agent": ["defaultChatParticipant", "chatParticipantAdditions"]}` | ingestion extensionsProposedApi.ts:43-55; product list REPLACES extension declaration :80-102; `isDefault` gated chatParticipant.contribution.ts:268, `locations`/`modes` :273; proposals confirmed extensionsApiProposals.ts:231/:78 | **DL-4** enable-for-built-ins, zero promotion: the extension manifest itself declares `enabledApiProposals: []`; the static `isDefault` participant only parses when the product force-enables the two proposals |
| `defaultChatAgent` | `null` | master gate chatEntitlementService.ts:458-460 (whole Copilot setup/entitlement stack no-ops without it); default-agent resolution prefers non-core isDefault extension participants (chatAgents.ts:478-484) | NULL-DELETES the key in the merger (**DL-16**) → Copilot setup machinery disabled, `flauz.agent` becomes the sole default agent; all knock-on surfaces catalogued in the canary checklist |
| `extensionsGallery` | (not set, not stripped) | base product.json at this SHA has **no** gallery key (46 top-level keys — verified during this rebuild; the work order's assumption was wrong) | v0 deliberately does not touch gallery posture; merger test 4 pins the actual posture as a tripwire |

## CONTRACT-DEVIATIONS

Seam contract §H interpretations encoded in v0 (all tested):

1. **`fail` is legal only from `execute`** (the contract's "any-active"
   clause applies to `cancel` only); illegal events are rejected with the
   allowed source statuses listed, and actor validation runs AFTER state
   validation (wrong actor from a valid state reports the actor error).
2. **`note` accepted but not persisted** in v0 ledger rows — the seven-field
   row shape is exact; `note` returns in future versions (Wave-4 hook).
3. **`evidenceId` format is `E-<seq>`** (sequence-based, not a hash).
4. **Artifacts directory is `.flauz/artifacts/<taskId>/`** with
   workspace-relative POSIX URIs in ledger rows.
5. **Non-transition event types append freely** (e.g. `created`) without
   changing status.
6. **`createCheckpoint` returns `null` for terminal tasks**; live refs are
   content-addressed `flauz-ckpt-<12hex>` fabricated at the seam level (no
   real chat-editing checkpoints in the sandbox — GAPS).
7. **Tamper detection lands on the NEXT row's `prev`** (the row hash is
   recomputed, never stored) — the last row's own content is only checkable
   via the caller's known sha256 (v0 limitation).

## DECISION-LOG-PROPOSALS

Re-derived after the reset from the surviving worklog (numbering follows the
pre-reset W3-F report; the TL should treat these as the same proposals):

- **DL-16**: overlay null-deletes merge semantics for `product.flauz.json`
  (null deletes the key; objects merge recursively; arrays replace).
- **DL-17**: `identifier` is not an IProductConfiguration key — drop it from
  the overlay spec.
- **DL-18**: `version` in the overlay conflicts with build-time stamping
  (gulpfile) — CI must reconcile (e.g. stamp from the overlay instead).
- **DL-19**: evidence ledger v0 is hash-chain only; signatures/keys are the
  Wave-4 SECURITY-MODEL hook (row shape already reserves nothing extra).
- **DL-20**: transition strictness as encoded above (fail-from-execute-only;
  actor-after-state validation ordering).
- **DL-21**: mark-flush cadence gap — extension-host `performance.mark`
  forwarding (extHostExtensionService.ts:647-649 → timerService.ts:617-623)
  has no guaranteed flush cadence at process exit; the bridge emits marks
  synchronously and accepts best-effort aggregation.
- **DL-22**: evidence `note` field dropped in v0 rows (see DEVIATIONS 2).

## GAPS-AND-SKIPS

Blocked or intentionally out of scope in this sandbox (MIGRATION-PLAN §5
discipline: no vscode builds, no real IDE runs):

1. **Real IDE launch** (participant rendering, real chat UI, real
   confirmation dialogs, shell-integration terminal exec in a real pty) —
   CI side; the fidelity mock is the in-sandbox substitute.
2. **Canary D5/D6 runtime verification** (chatIsEnabled without setup
   agents; status-bar entry absence) — VERIFY-IN-CI with explicit test
   commands recorded in the canary checklist.
3. **Real vendors** (Codex/Claude/Qwen adapters) — design-only stubs; no
   network, no entitlements.
4. **Model-driven plan generation** — v0 plans are deterministic with model
   attribution only (no `LanguageModelChat.sendRequest` in the golden path);
   flauz-mock is exercised by its own extension tests.
5. **Packaging** — `dist/extension.js` esbuild ESM bundle + shipping
   `core/service.mjs` alongside is CI work (README documents the constraint).
6. **typescript not installed in-extension** — zero-install discipline; the
   host toolchain binary provided `tsc --noEmit`.
7. **Push** — platform-blocked; transit is this staging + the git bundle
   (`wave3-f-agent-bridge.bundle`, range `9bf9ae764da..flauz/wave3/agent-bridge`).
8. **Last-row tamper visibility** — hash-chain v0 limitation (DEVIATIONS 7).

## U-1-CANARY-CHECKLIST

Full spec at `build/flauz/canaries/default-agent-checklist.md` (staged at
the same relative path here). Summary: **D1–D11** with closure statuses —
5 CLOSED-BY-DESIGN (D1 master gate, D2 sole-default resolution, D3
signed-out surfaces unreachable, D7 model picker, D8 copilot-dependent
surfaces dark), 2 VERIFY-IN-CI (D5 `chatIsEnabled`, D6 status-bar entry —
explicit commands recorded), 2 N/A (D4 no-gallery setup path, D9
experiment-gated surfaces), 2 DOCUMENTED-DEBT (D10 hard-coded Copilot
literals, D11 telemetry/debug assumptions). Every item carries file:line
citations from the tree at `9bf9ae764da`.
