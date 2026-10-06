# flauz-acceptance — the launch + post-release-acceptance plane (A-PROD-006-W2)

The closing receipts of the incidents loop's last two stages — the
`regression → release` transition's **release-identity** evidence and the
`release → post-release-verification` closure's
**post-release-verification-receipt** evidence (DL-87). Three commands, one
fail-closed launch act, one append-only receipt journal. The 21st flauz-*
extension.

## The honest scope (the honest-evidence law, DL-87)

This wave delivers **MACHINERY** over workspace state. **Production usage is
EMPTY by design**: the production launch has not happened. No record, test,
or sentence in this wave may claim a production launch, production usage, or
production-real evidence. The evidence label for everything in this wave is
**local-real** (workspace records) or lower, stated honestly. The launch
acts exercised by this plane's tests are **seeded workspace records**,
honestly labeled — the checklist artifacts are either planted through the
contract-duplicated shape (fixture-labeled) or cut by the REAL
`flauz.release.checklist` machinery over a seeded temp workspace
(local-real).

## The command surface (command-only activation: `onCommand:flauz.acceptance.*`)

| Command | What it does |
|---|---|
| `flauz.acceptance.launch` | The launch-act law (**fail-closed**): mints a release-acceptance record ONLY over a GREEN, FRESH `flauz.release.checklist` artifact (reads `.flauz/release/checklist-<stamp>.json` through the contract-pinned parser; refuses typed on **absent** / **torn** / **red** / **stale** — never a silent green). The record carries the acceptance id `flauz:acc:<16-hex>` from an explicit rng/seed input, the bound checklist artifact path **VERBATIM** + its checklistId (the release identity the incidents loop carries), the pinned product state (the version-inventory + census snapshot shapes, contract-pinned from flauz-release), and the **NAMED OWNING CHECKS** set (the checklist row kinds + the incident's named regression test when launched to close an incident loop; the binding resolves against the incidents ledger or is a TYPED DISCLOSURE, never a fabricated link). Persisted `.flauz/acceptance/acceptances.json` (`flauz.acceptance/v1`), append-only (the unique-id law: re-launching an id appends a NEW revision), census-visible, swept + banked (taskId `flauz-acceptance`). |
| `flauz.acceptance.verify` | The closing receipt: re-runs the named owning checks against the released state and banks the receipt — **pass or FAIL, both typed, both banked**. A FAILED receipt is the typed failure record the incidents reopen law consumes (the closed loop never hides a regression). The self-evaluable named checks are genuinely re-run over the workspace state (the bound checklist artifact re-read + its checklistId re-derived; the pinned product state re-read — presence + detected format version + parse cleanliness, the append-only growth honestly disclosed); a check the acceptance plane cannot itself evaluate is a **TYPED DISCLOSURE** row naming its owning surface (the honest-scope law), never a silent green. The receipt's evidence label comes from the frozen ladder (`fixture \| simulated \| local-real \| runtime-real \| live-provider \| production-real`) and is never promoted by wording. Journal `.flauz/acceptance/verify-<acceptanceId>.jsonl` (`flauz.acceptance-verification/v1`, append-only, one row per verify run with actor + timestampIso via the **INJECTED clock** — no `Date.now`/`new Date()` in src, grep-clean). |
| `flauz.acceptance.status` | The ledger view — the verdict table over every acceptance record: per-record bound checklist identity, revision count, owning-checks count, incident-binding state, latest receipt verdict (`pass \| fail \| none`) with its disclosure/fail counts. Record `.flauz/acceptance/status-<stamp>.json` (`flauz.acceptance-status/v1`), swept + banked census-visible. |

## The launch-act law (fail-closed)

The typed refusals, never silent greens:

| Refusal | When |
|---|---|
| `FLAUZ_ACCEPTANCE_NO_CHECKLIST` | `.flauz/release/` carries no checklist artifact (nothing has passed the beta gate in this workspace) |
| `FLAUZ_ACCEPTANCE_CHECKLIST_TORN` | the newest artifact does not parse as the `flauz.release-checklist/v1` shape, or its checklistId does not re-derive over its own bytes |
| `FLAUZ_ACCEPTANCE_CHECKLIST_RED` | the newest artifact's verdict is `NO-GO` (the beta gate failed) |
| `FLAUZ_ACCEPTANCE_CHECKLIST_STALE` | the operator named an explicit checklist path that is not the NEWEST one (the freshness law: a newer checklist supersedes the release identity) |
| `FLAUZ_ACCEPTANCE_CHECKLIST_NOT_FOUND` | the operator named a path that is not among the enumerated checklist artifacts |

## The gate vocabulary does not grow (DL-86's scope guard honored, DL-87 law 4)

The eleven prove-items of the production gate
(`reproducibleArtifacts · signingIntegrity · securityPosture · dataIsolation
· secretHandling · workerDurability · observability · backupRecovery ·
failureRollback · upgradeCompatibility · documentedCapabilities`) stay
verbatim in their owning plane (`flauz-production/src/gate.ts`). This plane
binds the gate by **READING** the checklist artifact's verdict field, never
by redefining it; `PROVE_ITEM_IDS` in `src/api.ts` is the read-pin
declaration, pinned by the contract suite against the owning gate source so
any vocabulary drift fails this wave's tests.

## The pin semantics (what verify compares — and what it deliberately does not)

The pinned product state carries, per surface file: presence, sha256, bytes,
and the detected format version. The verify re-read compares **presence +
detected format version + parse cleanliness** — never byte equality —
because the append-only surfaces (the evidence ledger above all) lawfully
GROW after the launch: byte growth is **disclosed**, never failed. A present
file gone absent, a detected format version change, a clean surface that
tore, a shrunken append-only file, or a destroyed pinned regression-receipt
ref — those are the released-state regressions the receipt FAILS on.

## The two-registry separation (DL-87, inheriting DL-86)

The workspace-local acceptance ledger (`.flauz/acceptance/`,
`flauz.acceptance/v1`, the OPERATIONAL launch + receipt state) and the
repository control plane (`docs/FLAUZ-PROGRAM/WORK-REGISTRY.md` — the
AUTHORITY for work items) are separate authorities. The acceptance surface
RECORDS the launch act + the closing receipts and LINKS to control-plane
state only by carrying ids VERBATIM; it never mints, edits, ranks or
supersedes control-plane state.

## The privacy law (the actor/seed canary)

The actor, the seed-derived id, and the owning-surface strings are the
free-form text inputs the acceptance surfaces carry. They are swept
**FAIL-CLOSED** for secret-shaped values BEFORE any record is written (a
secret-shaped input refuses the whole operation). The banked census row
(the evidence-ledger note row) carries the **sha256** of the artifact —
never the record text — so the canary test proves acceptance inputs never
reach banked census rows.

## The determinism law (the durability wave's structural law, mirrored)

No `Math.random`/`Date.now`/`new Date()` anywhere in `src/` outside the PU6
verbatim `format.ts` copy. The acceptance id (`flauz:acc:<16-hex>`) is
generated from an EXPLICIT rng/seed input (the id generator takes a seed
string and hashes it — the first 16 hex chars of `sha256(seed)`). The clock
is INJECTED: the default deterministic clock (epoch 0) lives in `globals.ts`
and is overridden by the extension layer (the host wall clock, wired with
the `determinism` grep exemption comment) and by tests (the
stepping-clock fixture).

## The STATION-PENDING doctrine

This extension **never regenerates** `build/flauz/security/bundle-manifest.json`.
The CI packaging-reproducibility bundle-manifest row **fails by design** on
worker branches (the pin is minted at the integration station at landing;
this wave's own pin lands there). This wave's two disclosed additive
shared-file edits: the packaging-parity triad rows (68 → 71) and the SBOM
component row (20 → 21). The station mints the bundle pin at landing and
runs the ten-gate battery after harvest; the worker does NOT touch
`bundle-manifest.json` or run `security-runtime-gate --generate`.

## The suite (mocha tdd)

`contract` (the schema-id pins; the eleven prove-items read-pin against the
owning gate source; the frozen evidence-label ladder; the acceptance id
shape + seed determinism; the duplicated serialization + chain contracts
byte-equal against the owning modules; the SURFACES registry + surface-path
pins against flauz-release; the checklistIdOf/checklistStamp byte-equality
pins; the real-sibling census/version-inventory equivalence over a seeded
workspace; the manifest shape; the banking cross-recognition) · `launch`
(the fail-closed refusal lattice: absent/torn/red/stale/not-found; the GO
mint over a planted artifact; the unique-id/revision-append law; the
incident binding resolved + disclosed-unresolvable; the named owning checks
set; the determinism) · `verify` (the closing receipt: the re-run of the
self-evaluable named check, the typed disclosure rows naming their owning
surfaces, the product-state pin pass + drift failures — a destroyed
release identity, a torn pinned surface, a destroyed regression receipt —
the append-only journal, pass AND fail both banked) · `status` (the verdict
table over seeded records, the honest-scope disclosure, the torn-ledger
honesty) · `privacy` (the canary sweep: secret-shaped actor/seed inputs
refuse the launch; the planted canaries never reach the banked census rows
or the renders).

The isolated-runner recipe (no repo install):

```sh
mkdir -p /tmp/labrun && cd /tmp/labrun && npm init -y >/dev/null && \
  npm i --silent --no-audit --no-fund mocha tsx @types/mocha
cd <repo-root>/extensions/flauz-acceptance
NODE_PATH=/tmp/labrun/node_modules \
  NODE_OPTIONS="--import file:///tmp/labrun/node_modules/tsx/dist/loader.mjs" \
  /tmp/labrun/node_modules/.bin/mocha --ui tdd test/*.test.ts
```
