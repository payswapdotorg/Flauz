# flauz-durability — the worker-durability plane (A-PROD-005-W4)

The wave the W1 production gate's `workerDurability` NOT-YET row names — the
gate's LAST refusal: the **long-running worker supervision** — the lane
registry, the heartbeat machinery, and the supervision verdict.

## The command surface (command-only activation: `onCommand:flauz.durability.*`)

| Command | What it does |
|---|---|
| `flauz.durability.register` | Registers a supervised worker lane: the typed lane record (lane id, the owning task/extension, the heartbeat interval, the staleness threshold, the escalation policy: `notify` / `checkpoint-and-restart` / `refuse`), persisted `.flauz/durability/lanes.json` (`flauz.durability-lanes/v1`). A lane id is **unique**: re-registering an id **refreshes its policy** (the interval, the threshold, the policy — the ring + escalation state survive), never duplicates. The record is swept fail-closed + banked census-visible (evidence-ledger note row, taskId `flauz-durability`). |
| `flauz.durability.heartbeat` | Records a heartbeat for a lane (the worker's own liveness signal): stamps the lane's beat history — a **bounded ring** (the last 32 stamps, the injected clock) — and classifies the **PRE-BEAT** liveness: `LIVE` / `STALE` (past the threshold) / `FLAT` (no beat ever, past one interval) / `UNKNOWN` (lane not registered — a **typed refusal**, never a guessed verdict). A STALE/FLAT classification triggers the lane's **escalation policy record**: the machinery RECORDS the escalation demand (what the policy demands); the EXECUTION of an actual restart routes through the owning task's own machinery — disclosed, never claimed. Record `.flauz/durability/heartbeat-<stamp>.json` (`flauz.durability-heartbeat/v1`), swept + banked. |
| `flauz.durability.status` | The supervision verdict: every registered lane with its liveness class, its beat-history shape (the inter-beat intervals — min/median/max + the jitter disclosure: the maximum deviation from the configured interval), its escalation state, and the **CHECKPOINT LAW consultation**: the workspace-bound record surfaces the lane's owning extension owns (through the W3 isolation audit's derivation surfaces, read-only) + the W2 backup plane's export anchor when one exists (the newest `.flauz-exports/export-<stamp>/export.json` the lane's workspace resolves). The typed verdict table per lane: `supervised-green` (live + state surfaces resolvable) / `stale` / `flat` / `unknown` / `degraded` (a lane whose state surfaces do not resolve — typed, never silent). Record `.flauz/durability/status-<stamp>.json` (`flauz.durability-status/v1`), swept + banked. |

## The liveness law (typed, never a guessed verdict)

Evaluated with the injected clock at the observation instant (the heartbeat
observes PRE-BEAT — what the supervision plane saw when the signal arrived):

- `UNKNOWN` — the lane is not registered: a typed refusal (no record, no guess);
- `FLAT` — no beat ever AND one interval has passed since registration;
- `STALE` — beats exist AND the gap since the last beat is past the staleness threshold;
- `LIVE` — the complement: a fresh last beat within the threshold, or a beatless
  lane still inside its first interval (the startup grace window — disclosed,
  never a silently green).

## The honest-boundary disclosure

This extension proves the **record-keeping + verdict machinery** (the lane
registry, the heartbeat ring, the escalation-demand records, the supervision
verdicts). The **execution** of an actual restart routes through the owning
task's own machinery; cross-process supervision is the **host's orchestration
posture** (disclosed, never claimed — the same posture as the W3 wave's
host-isolation disclosure). Evidence level: **local-real** (fixture lanes with
real heartbeat histories through the injected clock; the checkpoint-law
consultation over fixture workspaces carrying real record surfaces + a real
W2 export anchor produced through the W2 ports). Never claim runtime-real for
cross-process supervision.

## The verdict law

Liveness dominates: `stale` / `flat` verdicts ride the liveness class. For a
LIVE lane the checkpoint law decides: `supervised-green` when the lane's
owning extension has ≥1 workspace-bound surface in the consulted audit and
every one is present; `degraded` when a surface is absent, the owner owns
zero workspace-bound surfaces (typed absent: nothing durable behind the
lane), or the consulted audit is itself absent/torn (typed unknown). A torn
lane row in an otherwise-parsed registry carries the typed `unknown`
verdict; a torn registry persists the honest typed record (zero lanes + the
reason — never a guessed summary).

## The STATION-PENDING doctrine

This extension **never regenerates** `build/flauz/security/bundle-manifest.json`.
The CI packaging-reproducibility bundle-manifest row **fails by design** on
worker branches (the pin is minted at the integration station at landing;
this wave's own pin lands there). This wave's two disclosed additive
shared-file edits: the packaging-parity triad rows (62 → 65) and the SBOM
component row (18 → 19, instrument-regenerated through
`security-runtime-gate --row sbom --generate --sbom-out`). The
flauz-production gate's **workerDurability row flip** is the TL's station
work at landing (the boundary law: this wave never touches
flauz-production's src). The same station class: the flauz-isolation law
table's growth for this extension's `.flauz/durability/` home (until then
the W3 audit discloses `flauz-durability` as its typed UNKNOWN — the
fail-closed disclosure working as designed) and the flauz-production
capability catalog's durability entries.

## The suite (mocha tdd)

`register` (the uniqueness law, the policy refresh, the typed refusals) ·
`heartbeat` (the liveness classes with the injected clock — LIVE/STALE/FLAT/
UNKNOWN; the ring's bound; the escalation-demand records; the UNKNOWN typed
refusal) · `status` (the lane table, the interval statistics, the
checkpoint-law consultation over fixture workspaces with real record
surfaces + a banked export fixture through the W2 ports; the verdict table;
the torn-registry honesty) · `privacy` (the canary sweep — no secret-shaped
values in any durability record) · `contract` (the DL-32 pins: the duplicated
contracts byte-equal against the REAL owning modules — flauz-workspace's
ledger/watermark/canonical/sha256, flauz-isolation's audit consultation
surface, flauz-backup's export anchor; the schema-id pins; the manifest
shape).

The isolated-runner recipe (no repo install):

```sh
mkdir -p /tmp/labrun && cd /tmp/labrun && npm init -y >/dev/null && \
  npm i --silent --no-audit --no-fund mocha tsx @types/mocha
cd <repo-root>/extensions/flauz-durability
NODE_PATH=/tmp/labrun/node_modules \
  NODE_OPTIONS="--import file:///tmp/labrun/node_modules/tsx/dist/loader.mjs" \
  /tmp/labrun/node_modules/.bin/mocha --ui tdd test/*.test.ts
```

(The `@types/mocha` install + a gitignored `node_modules` symlink into the
extension dir — the `.gitignore` line 5 pattern — is what makes
`npm run typecheck-tests` resolve the mocha types in a pre-install tree; the
repo-root install carries them at the station.)
