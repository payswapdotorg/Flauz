# build/flauz/dogfood/ — the A-PROD-003 dogfood harness (W1)

The W1 harness for A-PROD-003 (dogfooding): the driver machinery + the
friction-log contract + the exercise lanes that the station then runs
for real in **W2 (live provider, station-side)**. Built on the
journey-drill pattern (`build/flauz/journey/journey.drill.ts`): it
imports the REAL product seams directly, constructs real
Agent OS / Model Fabric / Workspace OS / evidence-ledger objects, and
drives scripted-but-real scenarios with per-exercise receipts.

Everything here is additive harness code under `build/flauz/dogfood/**`.
Nothing here is a gate instrument; nothing here edits one.

## Files

| File | Role |
|---|---|
| `dogfood-driver.mjs` | THE DRIVER: boots the real seams on one mkdtemp workspace root (TaskService, EvidenceLedger + the fixture ed25519 signer, MemoryStore, OrchestrationStore, Model Fabric) and executes the exercise scripts against them. Selectable provider lanes. Writes the run receipts. |
| `frictionlog.mjs` (+ `frictionlog.d.mts`) | The friction-log contract, schema `flauz.dogfood-friction/v1` (append-only JSONL). The `.d.mts` is the hand-written declaration (the repo's `a2a.d.mts` zero-dependency discipline). |
| `fake-provider.mjs` | The fake/scripted provider lanes on a REAL local socket. The fake lane COMPUTES its answers at request time (the ledger-consumer map from the real tree; the workspace provider configuration from the real state files). The scripted-failing lane answers every completion with HTTP 500 -> the REAL adapter's typed `PROVIDER_OVERLOADED`. |
| `harnessTypes.ts` | The harness/exercise contracts (typed against the real seam modules). |
| `exercises/explore-repo.task.ts` | EXERCISE 1 (repository exploration): the question, the driver-side INDEPENDENT scanner + verifier, the exercise. |
| `exercises/provider-switch.task.ts` | EXERCISE 2 (provider switching + failure/recovery): the switch plan, the workspace-state verification, the friction policy, the exercise. |
| `dogfood.test.ts` | The mocha tdd suite (the friction-log schema + the exercise verification logic). |

## How to run

```sh
node --experimental-strip-types build/flauz/dogfood/dogfood-driver.mjs \
     [--repo <dir>]      # default: the repo containing this harness
     [--out <dir>]       # default: <workspace-root>/.flauz/dogfood-records
     [--exercise <id>]   # explore-repo | provider-switch (default: both)
```

Exit `0` = both exercises PASS (the G4 shape: both friction logs
non-empty, the explore-repo map 100% verified). Exit `1` = an exercise
verdict FAILed (read the receipts). Exit `2` = usage / fail-closed
env-contract error.

## Modes and the env-variable contract (the credential-free law)

- **fake-lane (default, no env):** the model intelligence is the
  fake/scripted provider lane — **fixture level, claimed exactly so,
  never wording-promoted**. The seams it drives are real (local-real);
  the answers are computed live from the tree/workspace by the local
  wire server, and the driver VERIFIES them (checked, not trusted).
- **live-provider (W2, station-side):** selected only when ALL THREE
  env vars are present — read from ENVIRONMENT VARIABLES ONLY (the
  vendor-neutral contract shape; never files, never inline):

  ```sh
  FLAUZ_LIVE_PROVIDER_BASE_URL=https://<vendor>/v1
  FLAUZ_LIVE_PROVIDER_API_KEY=<key>          # resolved through the
                                             # credentialRef env: ref
  FLAUZ_LIVE_PROVIDER_MODEL=<model-id>
  ```

  A PARTIALLY present contract FAILS CLOSED (exit 2, naming the missing
  variables) — the harness never silently falls back to the fake lane.
  In live mode the healthy lane is the real vendor; the
  scripted-failing lane remains the local HTTP 500 lane so the typed
  provider-failure/recovery exercise still exercises the product's real
  error taxonomy over the real adapter. No secrets are ever written to
  disk: the key material lives only in the process env and is resolved
  through the `env:FLAUZ_LIVE_PROVIDER_API_KEY` credential reference.

## The friction-log contract (schema `flauz.dogfood-friction/v1`)

One append-only JSONL file per exercise run
(`<out>/<exercise-id>.friction.jsonl`):

- **friction rows** — `{schema, type:"friction", ts, phase, kind,
  detail, recovery}` where `kind` is exactly the handoff's capture
  list: `failed-task | manual-intervention | confusing-ux |
  provider-failure | browser-env-failure | slow-path | recovery-defect
  | evidence-gap | upgrade-migration`. `recovery` is required on every
  row: `""` while unrecovered, and the recovery account once recovered.
  **A friction row with a non-empty `recovery` is the log's "recovery
  row"** (that is how the G5 receipt reads it).
- **timing rows** (the slow-path measurement) — `{schema,
  type:"timing", ts, phase, durationMs}`.

Friction is recorded HONESTLY: only what actually happens during the
run (a typed provider failure, a failed verification, a recovery). The
harness does not fabricate friction events; build-time observations
belong in the wave report, not the run log.

## The exercises and their receipts

**explore-repo** — the question: *"map every consumer of the evidence
ledger across extensions/flauz-\*: file + line + what it consumes"*
(operational definition pinned inside the prompt). The provider answers
by scanning the real tree at request time; the driver independently
scans (its own regex scanner), re-reads every claimed `file:line`, and
requires 100% soundness AND completeness. Receipts:
`explore-repo.verification.json` (the checked map),
`explore-repo.receipt.json`, the friction log, two hash-pinned
evidence rows (the answer as received + the verification).

**provider-switch** — the sequence `healthy -> scripted-failing ->
healthy`, each switch = the real providers-file enablement act + the
routing-policy rewrite + a fresh registry load + a durable routing
decision + ONE evidence row per switch (G5). The failing lane's typed
`PROVIDER_OVERLOADED` (retryable, short-backoff) feeds the product's
own bounded-retry bound (`resolveProviderRetryBound`); the recovery
switch proves the same call type succeeds again. The healthy-lane
answers are verified against the workspace's real model-state files.
Receipts: `provider-switch.report.json`, `provider-switch.receipt.json`,
the friction log (the typed provider-failure row WITH its recovery
account = the recovery row).

`run-summary.json` (schema `flauz.dogfood-run/v1`) carries the whole
run: mode, per-exercise verdicts/assertions/evidence ids/friction
census, and the local-lane wire census.

### What a live-model miss means in W2

In live mode the SAME verification runs against the real vendor's
answer. A map that is not 100% verified is a REAL dogfood finding: the
exercise FAILs, the friction log carries the miss (kind `failed-task`
with the drift detail), and the finding goes to the work registry
BEFORE any fix — exactly the A3 loop (capture actual friction, turn
real defects into registry items).

## The tests (the G6 recipe)

```sh
mkdir -p /tmp/labrun && cd /tmp/labrun && npm init -y >/dev/null && \
  npm i --silent --no-audit --no-fund mocha tsx
cd <repo-root>
NODE_OPTIONS="--import file:///tmp/labrun/node_modules/tsx/dist/loader.mjs" \
  /tmp/labrun/node_modules/.bin/mocha --ui tdd build/flauz/dogfood/dogfood.test.ts
```

## The scoped typecheck (the G7 recipe)

Isolated global typescript, never a repo install; `--types node,mocha`
for the test files; typeRoots outside the repo:

```sh
npm i -g typescript                                   # or any isolated install
mkdir -p /tmp/tsclab && cd /tmp/tsclab && npm init -y >/dev/null && \
  npm i --silent --no-audit --no-fund @types/node @types/mocha
tsc --noEmit --target ES2022 --lib ES2022 --module NodeNext \
    --moduleResolution NodeNext --allowImportingTsExtensions --strict \
    --skipLibCheck --types node,mocha \
    --typeRoots /tmp/tsclab/node_modules/@types \
    build/flauz/dogfood/harnessTypes.ts \
    build/flauz/dogfood/exercises/explore-repo.task.ts \
    build/flauz/dogfood/exercises/provider-switch.task.ts \
    build/flauz/dogfood/dogfood.test.ts
```

## Honest evidence levels (never promoted)

- the SEAMS the harness drives (task envelope, session claim, routing
  decisions, adapter streaming over a real socket, the evidence
  ledger): **local-real**;
- the model INTELLIGENCE in the fake/scripted lanes: **fixture**;
- the typed provider-failure/recovery classes: **local-real** (the
  product's real code paths; the failing wire itself is the scripted
  lane);
- `live-provider` is claimed ONLY by the station's W2 run with the env
  contract present.
