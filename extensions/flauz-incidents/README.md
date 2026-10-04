# flauz-incidents — the incident/problem registry plane (A-PROD-006-W1)

The closed-loop machinery of the handoff's A6 law — every material production
issue follows `incident → reproducible-finding → registry-item → fix →
regression → release → post-release-verification`. Three commands, one closed
loop, one ledger. The 20th flauz-* extension.

## The honest scope (the honest-evidence law, DL-86)

This wave delivers **MACHINERY** over workspace state. **Production usage is
EMPTY by design**: the launch has not happened. No record, test, or sentence
in this wave may claim a production incident, production usage, or
production-real evidence. The evidence label for everything in this wave is
**local-real** (workspace records) or lower, stated honestly. The suite
proves the machinery over **seeded workspace records**, honestly labeled —
the telemetry failure census, the durability heartbeat escalation record,
and the dogfood friction log are REAL workspace records produced by hand
through the owning shapes (the contract-duplicated shapes pinned byte-equal
against the owning modules by the contract suite).

## The command surface (command-only activation: `onCommand:flauz.incidents.*`)

| Command | What it does |
|---|---|
| `flauz.incidents.report` | The typed incident intake — the incident record (id `flauz:inc:<16-hex>` from an explicit rng/seed input, class, severity sev1..sev4, affected surface, repro note, evidence refs under `.flauz/` only, reportedAtIso, and the **typed source binding**: `manual` (operator-entered, disclosed as such) \| `telemetry-census` (a `flauz.failures.list` census entry) \| `durability-escalation` (an escalation-demand record) \| `dogfood-friction` (a `flauz.dogfood-friction/v1` entry). A source binding that cannot resolve is a **TYPED DISCLOSURE** record, never a dropped row and never a fabricated/inferred incident. Persisted `.flauz/incidents/incidents.json` (`flauz.incidents/v1`), append-only, census-visible, swept + banked (taskId `flauz-incidents`). The **unique-id law**: re-reporting an id appends a NEW revision, never duplicates. Swept **FAIL-CLOSED** for secret-shaped values in repro notes (the privacy law: a canary test proves repro notes never reach banked census rows). |
| `flauz.incidents.advance` | The loop state machine — per-incident loop stages FROZEN VERBATIM from the A6 law (`incident → reproducible-finding → registry-item → fix → regression → release → post-release-verification`). Typed forward transitions ONLY, each evidence-bearing, each carrying its evidence label from the frozen ladder (`fixture \| simulated \| local-real \| runtime-real \| live-provider \| production-real` — never promote a label by wording). The **closure law (fail-closed)**: `fix → regression` REQUIRES regression evidence (the named regression test's passing receipt); `regression → release` requires the release identity (the owning release/checklist record pointer); the loop closes ONLY on post-release verification evidence (a re-run of the named owning checks against the released state, banked as the closing receipt). Missing evidence = typed REFUSAL naming the exact missing stage-evidence kind, never a silent skip; NO stage may be skipped forward. The **ONE reopen law**: a failed post-release verification REOPENS the incident with the failure as evidence (a closed loop never hides a regression). The `registry-item` stage carries the repo-side registry item id **VERBATIM** (the two-registry separation: the product surface never mints, edits, ranks or supersedes control-plane state). Transition journal `.flauz/incidents/loop-<incident>.jsonl` (`flauz.incidents-loop/v1`, append-only, one row per transition with actor + timestampIso via the **INJECTED clock** — no `Date.now`/`new Date()` in src, grep-clean). |
| `flauz.incidents.status` | The ledger view — the verdict table over every incident: per-incident loop stage, source-binding state (`resolved \| disclosed-unresolvable \| manual-disclosed`), closure readiness (the EXACT list of missing stage-evidence kinds, typed), and the loop verdict (`closed \| open \| reopened \| refused-evidence`). Record `.flauz/incidents/status-<stamp>.json` (`flauz.incidents-status/v1`), swept + banked census-visible. |

## The two-registry separation (DL-86 ADOPT)

The workspace-local incident ledger (`.flauz/incidents/`,
`flauz.incidents/v1`, the OPERATIONAL loop state) and the repository control
plane (`docs/FLAUZ-PROGRAM/WORK-REGISTRY.md` — the AUTHORITY for work items)
are separate authorities. The product surface RECORDS the loop state and
LINKS to control-plane state by carrying the repo-side registry item id
VERBATIM at the `registry-item` stage; it never mints, edits, ranks or
supersedes control-plane state (no second persistence authority — the
ARCHITECTURE-LOCK's §11 law applied to the incident lane).

## The loop verdict law

- `closed` — the loop closed on post-release verification evidence (the
  `post-release-verification` stage reached via a `close` transition);
- `open` — the loop is mid-progress (any stage before closure, OR a forward
  transition landed at the closure stage);
- `reopened` — the loop was closed and then reopened by a failed
  post-release verification (the last transition was `reopen`);
- `refused-evidence` — a transition was refused for missing evidence (the
  last transition was `refusal`; the incident is stuck at the refused stage,
  with the exact missing stage-evidence kind disclosed).

## The closure law (fail-closed)

The per-transition evidence requirements (the exact missing stage-evidence
kinds the refusals name):

| From stage | Required evidence kind |
|---|---|
| `incident` | `reproducible-finding-evidence` (the reproduction account) |
| `reproducible-finding` | `registry-item-id` (the repo-side registry item id VERBATIM) |
| `registry-item` | `fix-evidence` (the fix changeset pointer) |
| `fix` | `regression-receipt` (the named regression test's passing receipt) |
| `regression` | `release-identity` (the owning release/checklist record pointer) |
| `release` | `post-release-verification-receipt` (the re-run of the named owning checks against the released state) |
| `post-release-verification` | (none — the closed stage; the loop closes here) |

Missing evidence = typed REFUSAL naming the exact missing stage-evidence
kind, never a silent skip; NO stage may be skipped forward. The ONE reopen
law fires ONLY from the closed stage (`post-release-verification`): a failed
post-release verification REOPENS the incident (the closed loop never hides
a regression) — the reopen moves the incident back to `fix` (a new fix is
needed for the production regression), with the failure as evidence.

## The privacy law (the repro-note canary)

The repro note is the one free-form text field the incident record carries
(the operator's reproduction account). It is swept **FAIL-CLOSED** for
secret-shaped values BEFORE the record is written (a secret-shaped repro
note refuses the whole report; the ledger is never written with a secret).
The banked census row (the evidence-ledger note row) carries the **sha256**
of the artifact — never the repro note text — so the canary test proves
repro notes never reach banked census rows.

## The determinism law (the durability wave's structural law, mirrored)

No `Math.random`/`Date.now`/`new Date()` anywhere in `src/`. The incident id
(`flauz:inc:<16-hex>`) is generated from an EXPLICIT rng/seed input (the id
generator takes a seed string and hashes it — the first 16 hex chars of
`sha256(seed)`). The clock is INJECTED: the default deterministic clock
(epoch 0) lives in `globals.ts` and is overridden by the extension layer
(the host wall clock, wired with the `determinism` grep exemption comment)
and by tests (the stepping-clock fixture). The grep gate
(`grep -rn "Math.random\|Date.now\|new Date(" src/ | grep -v "determinism\|injected"`)
prints nothing for this extension's `src/`.

## The STATION-PENDING doctrine

This extension **never regenerates** `build/flauz/security/bundle-manifest.json`.
The CI packaging-reproducibility bundle-manifest row **fails by design** on
worker branches (the pin is minted at the integration station at landing;
this wave's own pin lands there). This wave's two disclosed additive
shared-file edits: the packaging-parity triad rows (65 → 68) and the SBOM
component row (19 → 20). The station mints the bundle pin at landing and
runs the ten-gate battery after harvest; the worker does NOT touch
`bundle-manifest.json` or run `security-runtime-gate --generate`.

## The suite (mocha tdd)

`contract` (the schema-id pins; the frozen loop vocabulary exactness — stage
list pinned VERBATIM, transition map total, evidence-label ladder; the
duplicated serialization + chain contracts byte-equal against the owning
modules — flauz-workspace, flauz-durability, flauz-telemetry, the friction
log; the source-record shapes — the telemetry failure census, the durability
heartbeat, the dogfood friction row; the manifest shape) · `report` (the
intake laws: the four source bindings, the unresolvable-binding disclosure,
the unique-id + revision-append law, the evidence-ref scoping, the privacy
canary, the determinism, the typed refusals) · `advance` (the full legal
forward transition lattice, the closure-law refusals with the exact
missing-evidence kinds, the ONE reopen law, the evidence-label ladder per
transition, the verbatim registry-id carry at the registry-item stage, the
typed refusals) · `status` (the verdict table over seeded workspace records,
the three source-binding states, the verdict law, the honest-scope
disclosure, the torn-ledger honesty, the seeded-workspace verdicts).

The isolated-runner recipe (no repo install):

```sh
mkdir -p /tmp/labrun && cd /tmp/labrun && npm init -y >/dev/null && \
  npm i --silent --no-audit --no-fund mocha tsx @types/mocha
cd <repo-root>/extensions/flauz-incidents
NODE_PATH=/tmp/labrun/node_modules \
  NODE_OPTIONS="--import file:///tmp/labrun/node_modules/tsx/dist/loader.mjs" \
  /tmp/labrun/node_modules/.bin/mocha --ui tdd test/*.test.ts
```
