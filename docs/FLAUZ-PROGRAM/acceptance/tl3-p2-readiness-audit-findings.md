# TL3-P2 Product-Readiness Audit — Candidate Findings (P2-FIX format, awaiting TL4 routing)

**Provenance:** the TL3-P2 product-readiness audit wave (three partitions — A browser, B environments, C resources+continuity), worker-lane deliveries at pinned base `c27de198e14576a9e4ef84681ff061b72f452795`, station-verified and landed as PR #72 (partition A, `0f5b1b12347f`), PR #73 (partition B, `adbcd477be79`), PR #74 (partition C, `4fe77bc593f0`). The findings below are the wave's NON-FIXED observations — every fixed finding rode the landed PRs with fails-on-base regression pins; the two architecture-locked permanent constraints (G5 browser-partition minting, G3 chat.agent.networkFilter default) are recorded in their owning records (extensions/flauz-browser/INTEGRATION-GAP.md, WORK-REGISTRY DL-75/DL-76) and are NOT repeated as candidates here. Candidate IDs are provisional (CF-TL3A/B/C-n); the P2-FIX id namespace stays with TL4's routing.

---

## CF-TL3A-1 — popup-gate placement does not intercept `window.open` popups on real Chromium (one TL-adjudicated gate-placement redesign)

**CANDIDATE — awaiting TL4 routing.** (Upstream: the audit's F3, consolidating real-Chromium drill findings F-DELIVERY + F-POPUP-URL + F-OPENER-BLOCK, TL3-003.)

- Observable behavior: the landed TL3-002 popup/new-target gate sits on page-session `Target.setAutoAttach`; on real Chromium (153.0.8010.52) that placement receives NO browser-level popup targets — a `window.open`/`target=_blank` to a denied host free-runs past the gate: zero popup-gate events fire, the deny path never engages. Additionally, at browser-level attach with `waitForDebuggerOnStart`, `targetInfo.url` is EMPTY (the pending URL is unavailable at gate time), and `window.open` blocks the opener while a held popup is closed un-released (the deny-path timing shape).
- Evidence + runtime level: runtime-real — the pinned base's real-Chromium hardening drill records all three facts verbatim (`PASS 3.1d-3 FINDING F-DELIVERY … zero popup-gate events fired`; `PASS 3.1d-6b … targetInfo.url is EMPTY STRING at attach`; `PASS 3.1d-6c/8c FINDING F-OPENER-BLOCK`). The same drill proves the primitives a correct gate needs ALL hold on real Chromium (3.1d-5..8b: browser-level intercept+hold, close-before-use via `Target.closeTarget`, release via `Runtime.runIfWaitingForDebugger` — the release command itself fixed by the partition-A landing PR #72).
- Owning domain + proposed owning TL: browser runtime / security gate semantics (TL3), with the placement + URL-observation strategy requiring TL adjudication (the standing INTEGRATION-GAP "What remains" record reserves exactly this decision).
- Proposed contract change (if any): a gate REDESIGN — browser-level auto-attach placement plus a URL-observation strategy (post-commit observe-and-close, Fetch-domain interception, or opener-scope attribution via `openerId`) — which changes the landed, unit-pinned TL3-002 gate semantics (pre-use gating, the `PopupGateEvent` contract, evidence timing). A partition audit may not unilaterally rewrite pinned security semantics; the decision rights belong to the TL adjudication this routing requests.
- Acceptance test: on real Chromium, `window.open('https://denied-host.example')` from an agent-driven tab must produce a popup-gate event with a DENY verdict and the popup must never commit a load (zero frames on the denied host), while an allowed popup must release and commit; the drill's 3.1d family flips from FINDING-pinned to assertion-pinned.
- Architecture impact: medium — security-semantics redesign inside the browser extension's runtime surface (no fork-critical files; `src/vs/**` untouched).

## CF-TL3A-2 — URLs (including query-string credentials) are recorded verbatim in verdict notes, journal tab URLs and popup-gate records

**CANDIDATE — awaiting TL4 routing.** (Upstream: the audit's F4, A10 canary-secret observation.)

- Observable behavior: a planted canary URL `…?token=glauz-p2-canary-token-9f31c7aa4d` appears verbatim in navigation-verdict notes, journal tab URLs and popup-gate records. The architecture's redaction control point is the continuity export (SECRET-REDACTION), which is OUTSIDE the browser partition.
- Evidence + runtime level: local-real — the canary-secret audit run on the audit tree shows the DENY path put the canary NOWHERE on the wire (zero CDP commands for denied operations), but the persistence surfaces above carry it verbatim.
- Owning domain + proposed owning TL: the evidence/continuity contract lanes (TL3 continuity + TL2 evidence consumers); the decision is where redaction belongs (at-record vs at-export).
- Proposed contract change (if any): either (a) a redaction transform at the journal/popup-gate record boundary (URL query normalization), or (b) an explicit law that continuity export is the single redaction point and the raw records are trusted-internal (documented posture).
- Acceptance test: a canary-bearing URL must not survive the continuity export bundle (already the law); if (a) is chosen, the journal/popup-gate records must normalize query strings at write time.
- Architecture impact: small — evidence-contract wording + at most a normalization helper; no runtime semantics change.

## CF-TL3B-1 — the flauz-environments fixed harness path resolves relative to `src/extension.ts`; the TL1 packaging step must ship `fixtures/` next to `dist/`

**CANDIDATE — awaiting TL4 routing.** (Upstream: partition B compatibility note; pre-existing, documented residual.)

- Observable behavior: `extensions/flauz-environments/README.md:525-527` documents that the fixed harness path (`../fixtures/env-agent.ts` relative to `src/extension.ts`) works in the v0 dev flow (running from source) but a packaged extension would lose the fixtures unless the bundler ships them.
- Evidence + runtime level: local-real — path resolution inspection + the README's own documented residual; the lifecycle journey drills depend on the harness.
- Owning domain + proposed owning TL: TL1 packaging/bundler.
- Proposed contract change (if any): the TL1 packaging step copies `extensions/flauz-environments/fixtures/**` alongside `dist/`, and the CI packaging-parity check asserts its presence.
- Acceptance test: the packaging-parity job fails when `fixtures/` is absent from the packaged tree.
- Architecture impact: none (packaging only).

## CF-TL3B-2 — executor ops have no cancellation ports: an in-flight lifecycle op always runs to completion

**CANDIDATE — awaiting TL4 routing.** (Upstream: partition B remaining-risk record; surfaced by the D1 `OP_IN_FLIGHT` fix.)

- Observable behavior: with the landed one-mutating-op-per-environment guard, a second op issued while one is in flight is rejected (never interleaved) — but the in-flight op itself always runs to completion. A "destroy aborts a slow start mid-effect" semantic is impossible without a cancellation port on `EnvironmentExecutor`.
- Evidence + runtime level: local-real — the D1 regression probes (landed, PR #73) pin the rejection behavior; the completion-inevitability is direct executor-semantics inspection.
- Owning domain + proposed owning TL: environments architecture (TL3) — an architecture decision for a future wave, recorded here per the audit's honest-scope law.
- Proposed contract change (if any): a cancellation port on `EnvironmentExecutor` (typed `OP_CANCELLED` outcome + partial-effect reconciliation rules), gated on TL adjudication of the partial-effect semantics.
- Acceptance test: a destroy issued while a slow start is mid-effect lands a cancelled start and a terminal destroyed envelope, with the ledger recording both honestly.
- Architecture impact: medium — new executor port + partial-effect reconciliation semantics.

## CF-TL3B-3 — `SshCliExecutor.remotePidAlive` reads a spawn failure as "not alive" (single-invocation window)

**CANDIDATE — awaiting TL4 routing.** (Upstream: partition B remaining-risk record.)

- Observable behavior: a binary vanishing in the single-invocation window between a successful state read and the `kill -0` liveness probe can classify a live-but-unverifiable pid as gone. The direction is fail-closed verdicts, never healthy — the window is one invocation inside one op.
- Evidence + runtime level: local-real — executor-seam inspection (sshCli.ts); the D3 teardown-honesty drills (landed) cover the adjacent binary-vanish class.
- Owning domain + proposed owning TL: environments provider seams (TL3).
- Proposed contract change (if any): distinguish `spawnError` (unverifiable) from a clean exit-status "not alive" verdict in `remotePidAlive`, surfacing an `UNVERIFIABLE` typed outcome rather than "gone".
- Acceptance test: a `kill -0` that spawn-fails (binary gone) while other probes worked yields `UNVERIFIABLE`, not "not alive", and the op outcome fails closed.
- Architecture impact: small — one typed-outcome addition inside the ssh executor seam.

## CF-TL3C-1 — edge-matrix vs plan-family vocabulary asymmetry: `RESTORABLE_KINDS` admits kinds with no v0 restoration family

**CANDIDATE — awaiting TL4 routing.** (Upstream: partition C compatibility note CN-01.)

- Observable behavior: `EDGE_LEGALITY`'s `RESTORABLE_KINDS` (extensions/flauz-resources/src/api.ts) admits `task`, `agent-session` and `workflow` as `restored-from`/`snapshot-of` from-kinds, but `ContinuityService` (`src/continuity.ts` `FAMILY_BY_KIND`) has no v0 restoration family for them — the typed error documents the closed set. Restoring such a snapshot is expressible in the graph grammar but unexecutable in the service.
- Evidence + runtime level: local-real — the partition-C audit's C2/C4 checklist probes (landed evidence pins, PR #74) pin both sides of the asymmetry.
- Owning domain + proposed owning TL: TL3 lead jointly with the flauz-workspace (task envelope) and Agent OS (agent sessions) lanes — minting those plan families would duplicate the owning lanes' contracts prematurely (INTEGRATION-GAP rows 1/3 mark them Wave-next); the legality matrix is a DL-R2 deliberate joint update (matrix + tests + fixtures together).
- Proposed contract change (if any): when the workspace/Agent-OS lanes define their restoration families, the joint update extends `FAMILY_BY_KIND` + the matrix + fixtures in one DL-R2-shaped change.
- Acceptance test: a `restored-from` edge on a `task`-kind ref resolves to a real restoration family (or the matrix stops admitting the kind).
- Architecture impact: small — but deliberately deferred to the owning lanes' wave.

## CF-TL3C-2 — `vscode.workspace.fs` has no append primitive; the port approximates atomic append as read + tmp + rename

**CANDIDATE — awaiting TL4 routing.** (Upstream: partition C compatibility note CN-02.)

- Observable behavior: the vscode port's appendFile (extensions/flauz-resources/src/extension.ts) is a non-atomic in-place rewrite in the base; the landed partition-C fix approximates atomic append as read + tmp + atomic rename (byte-preserving, non-tearing) — a read-modify-write amplification per append.
- Evidence + runtime level: local-real — TL3C-12 (landed, PR #74) pins the tearing behavior on base and the atomic-rename fix; the amplification is direct port inspection.
- Owning domain + proposed owning TL: platform surface review (TL1/worker-A lane) — out of partition C.
- Proposed contract change (if any): a platform-level append API (or a sanctioned fs-port append strategy) would remove the amplification; alternatively the posture is documented as the port's cost model.
- Acceptance test: none beyond the landed TL3C-12 regression (the candidate records the cost, not a defect).
- Architecture impact: none (performance posture).

## CF-TL3C-3 — unkeyed hash chains: a consistent whole-tail ledger rewrite (recomputing every `prev` link + digests + envelope together) is beyond unkeyed tamper-evidence

**CANDIDATE — awaiting TL4 routing — informational, architecture-approved future strengthening.** (Upstream: partition C honest-residual record; DL-20 Wave-4 pattern.)

- Observable behavior: the landed per-row `prev` chain (TL3C-04, PR #74) detects every single-record, reorder, delete, truncate and digest edit — the realistic lazy-tamper class — on both the resources provenance ledger and the continuity ops ledger. An attacker who rewrites an entire tail consistently AND the envelope together is beyond unkeyed tamper-evidence; the final record's metadata is covered by its digests but not by a successor link. A hard-crash window in restore Phase 3 (detectable, not auto-healed) is the same class of residual.
- Evidence + runtime level: local-real — the tamper-evidence regression battery (landed) enumerates the detected classes; the undetectable class is construction-level.
- Owning domain + proposed owning TL: evidence-ledger architecture (TL3 + the station's DL-20 record names the signed-checkpoint hook as the Wave-4-pattern future).
- Proposed contract change (if any): the signed-checkpoint hook (DL-20 pattern) — periodic keyed checkpoints anchoring the chain tail.
- Acceptance test: a consistently-rewritten tail without the checkpoint key fails verification at the first checkpoint boundary.
- Architecture impact: medium — new key-holding boundary (where the signing key lives is an architecture decision).
