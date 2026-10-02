# Flauz Telemetry

Telemetry with explicit privacy controls + provider/environment failure
handling (A-PROD-004-W4, the beta-readiness fourth wave; TL-A product
completion lane).

Landed waves this extension builds on: W1 diagnostics + support/debug bundle
(`flauz-diagnostics`, PR #128), W2 durable-state backup/export + crash
recovery (`flauz-backup`, PR #133), W3 workspace migration/upgrade safety +
rollback (`flauz-migration`, PR #134). This wave's foundation reuse: the
telemetry privacy controls reuse the W2 canary discipline (the secret-shape
sweep), and the failure UX follows the W3 typed-refusal grammar (REFUSED,
never a wall).

## The privacy law (this extension's product)

1. **Opt-in by default.** Zero collection until the operator explicitly
   enables telemetry (`flauz.telemetry.config` with `{ enable: true }`).
   A record attempt while disabled is a typed refusal
   (`FLAUZ_TELEMETRY_DISABLED`), never a silent no-op.
2. **Local-first.** Aggregates persist workspace-locally under
   `.flauz/telemetry/` (config + ledger). There is NO network egress anywhere
   in this extension in v0 -- no fetch, no http, no socket; nothing leaves
   the machine, and the report command reads the local ledger only.
3. **Declared before enabled.** Every dimension telemetry CAN record is
   enumerated in a declared event schema (`src/schema.ts`) the operator can
   inspect BEFORE enabling: event kind, surface, outcome, duration-bucket,
   error-code (a taxonomy class id) and the identity id fields. The config
   pins the schema digest at enable time; a drifted digest refuses every
   record pass typed until the operator re-inspects and re-enables.
4. **Aggregates only, never contents.** Event CONTENTS (prompts,
   completions, provider payloads, message texts, free-form notes) are NEVER
   recorded -- not redacted-then-recorded, never recorded. Durations are
   recorded as buckets, never raw values. Every value comes from a closed
   vocabulary plus ids (ids are the beta gate's metadata allowlist). The
   canary sweep deep-walks every would-be-written artifact before a single
   byte is written and refuses the whole batch on any secret-shaped value
   (fail-closed, the W1 bundle law).

## Commands

- `flauz.telemetry.config` -- the opt-in plane: renders the declared schema
  FIRST (the inspect-before-enable disclosure), then the live state
  (enabled / retention / pinned digest / last consent event). With
  `{ enable: true | false }` it applies the explicit change and records the
  consent event itself (in the config artifact AND as a ledger row -- the
  audit of the operator's action, not collection). With
  `{ retentionDays: N }` it changes the pruning window (1..3650, default 30).
- `flauz.telemetry.record` -- the collection plane: when ENABLED, observes
  the REAL durable surfaces, folds the observations into closed-vocabulary
  aggregate rows, sweeps the whole batch (fail-closed), applies the
  retention prune, appends to `.flauz/telemetry/ledger.jsonl`, and banks a
  census-visible evidence row (see below). When DISABLED: typed refusal.
- `flauz.telemetry.report` -- the inspection plane: the aggregate view of
  the local ledger (per-surface event counts, outcome distributions, duration
  histograms, the error-code census). No network, no export.
- `flauz.failures.list` -- the operator UX of the failure half: the recent
  failure census from the local ledger + the typed taxonomy, grouped by
  failure class, with the affected surfaces, the affected identities (ids
  only), the event counts, the per-day time distribution over the retention
  window, and the operator-facing remediation hints. Failures are
  FIRST-CLASS queryable state, not scattered logs.

## The observed surfaces (local-real, read-only)

The record pass derives its observations from the durable state the prior
waves' extensions actually produce (contract-duplicated parsers, the DL-32
law; never imported across extension boundaries from src):

- `.flauz/models/routing-decisions.jsonl` (flauz-models) -- per-provider-lane
  call outcomes: `ok` on the selected lane (identity = the provider id), or
  the typed environment/provider incompatibility (`no-candidate`).
- `.flauz/orchestration/journal.jsonl` (flauz-agent core) -- the
  provider-retry rows (the DL-35 typed provider error codes, the retry
  window outcome, the wait applied bucketed) and the step transitions
  (started -> succeeded/failed: the step outcome + the duration bucket
  derived from the row timestamps). Payload texts are never read.
- `.flauz/environments.json` (flauz-environments) -- per-environment
  validation outcomes: `valid`, `disabled`, or `invalid` (typed
  environment-validation-failed).
- `.flauz/workflows/W-NNN.json` (flauz-workflow) -- per-workflow step
  outcomes (`ok` / `failed`).

Unparseable surfaces degrade honestly: the surface's name is reported, no
events are faked.

## The typed failure taxonomy

Every failure mode the prior waves' surfaces can produce gets a TYPED record:
the failure class, the exact surface + provider/environment identity, the
operator-facing remediation hint, and the telemetry dimension it maps to
(`src/failures.ts`). The taxonomy types the REAL closed vocabularies: all 14
`ProviderErrorCode` values of the flauz-models contract, the validation-shaped
flauz-environments lifecycle codes, and the routing layer's `no-candidate`
(the environment/provider incompatibility). The six classes the beta gate
names verbatim -- provider unreachable, provider auth rejected, environment
validation failed, provider lane capacity, model timeout, the
environment/provider incompatibility -- are all present. An untypable code
is a loud error (residue for a later wave), never an improvised class.

## Census visibility (the W1 diagnosability)

Every record pass that appends rows banks one evidence-ledger note row
(`flauz.telemetry-event` tail pinned, taskId `flauz-telemetry`) -- the W3
banking law -- so the next `flauz.diag.show` census genuinely reports the
telemetry activity (rowCount + 1, kindCounts.note + 1, a new chain head).
The evidence size watermark is resynced after banking when the owner wrote
one, keeping every post-pass integrity verdict GREEN.

## Architecture

The node-free core discipline (the W2/W3 substrate-row precedent): every
module under `src/` except `extension.ts` is pure TypeScript over injected
ports (`TelemetryFsPort`, `Clock`, `OutputChannelPort`). `extension.ts` is
the ONLY node dependency (the `node:fs/promises` wiring) -- the packaging
web-blocked posture row, with the web recovery path being a
`vscode.workspace.fs`-backed port. Activation is command-only
(`onCommand:flauz.telemetry.*` + `onCommand:flauz.failures.list`), per the
activation-lint R1-R3 discipline.

## Evidence level

local-real: the tests construct fixture workspaces by driving the REAL
owning services (test-time cross-extension imports are the sanctioned pin
pattern; src never crosses boundaries) and fixture failure sequences, then
exercise the real durable formats, the real census integration and the real
workspace layout. No live provider is needed or claimed for this wave.

## Development

```
npm run typecheck          # the src-only program (strict + noUnused*)
npm run typecheck-tests    # the full program (relaxed for sibling sources)
npm test                   # the mocha tdd suite
```
