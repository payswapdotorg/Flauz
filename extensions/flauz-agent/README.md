# Flauz Agent Bridge (`extensions/flauz-agent`)

Wave 3 Lane F vertical slice: Flauz's own chat participant (`flauz.agent`,
DL-3 — not a Copilot fork), a human-gated terminal tool, and a workspace task
seam with an append-only, hash-chained evidence ledger.

## Layout

```
package.json        chatParticipants[flauz.agent] (isDefault, panel, ask+agent,
                    commands approve/request-changes/sign-off/cancel),
                    languageModelTools[flauz_terminal], activationEvents
                    onStartupFinished + two narrow onCommand:flauz.*
core/
  contracts.mjs     pure seam-contract logic: the 9 legal transitions,
                    canonicalJson, rowHash, ledger verification
  contracts.d.mts   hand-written types for the .mjs (imported `import type`
                    from src — never loaded from shipped code)
  service.mjs       zero-dep G-side service: hello/ready handshake over stdio
                    (newline-delimited JSON), the 7 flauz.workspace.* commands,
                    tasks.json envelope, hash-chained evidence ledger,
                    globalStorage event relay
  protocol.mjs      TL1-003 seam definition: version negotiation, the
                    SEAM_METHODS registry, structured errors, event envelopes
  serviceBoundary.mjs  TL2-S1 Agent OS service boundary: the orchestration-
                    side adapter composing SeamClient (transport) and
                    protocol.mjs (version/gating truth) - registry-derived
                    method gate, flauz.os.err.* fail-closed failure taxonomy,
                    client-side idempotency memo, health watch, start/
                    recover (re-spawn + re-hello + state re-read)
  serviceBoundary.d.mts  hand-written types for the boundary (.d.mts
                    discipline, like contracts.d.mts)
  seamUsageMap.json TL2-S1 machine-readable map: which seam methods/events
                    serve each Agent OS lifecycle phase today, which need
                    ADDITIVE protocol extensions (versioned artifact
                    'flauz.seam-usage-map/v1')
  orchestration.mjs / orchStore.mjs / policy.mjs / recovery.mjs /
  runtime.mjs / routing.mjs
                    the durable orchestration core (TL2-001/TL2-004):
                    replay-derived task graphs over a hash-chained journal,
                    retry/cancel/takeover policy, restart recovery, the
                    deterministic executor, multi-agent A2A routing;
                    approval/takeover/lease/claim ops are first-class
                    transitions with minted evidence rows
  orchProtocol.mjs / orch-protocol.schema.json / orchMediator.mjs
                    the orchestration service protocol contract (TL2-001
                    M4): flauz.orch/v1 method registry + event catalog +
                    typed failure taxonomy ABOVE the TL1-003 seam, the
                    versioned JSON schema, and the in-process mediator
                    fixture the future stateful service dispatches through
src/
  extension.ts      activation wiring + the documented code/flauz/* marks
  participant.ts    vscode.chat.createChatParticipant handler + followups
  tools/terminalTool.ts  vscode.lm.registerTool + HumanApproval
                    confirmationMessages + shell-integration exec
  orchestrator.ts   golden-path state machine (plan -> approve -> tool ->
                    evidence -> verify-pass -> sign-off)
  models.ts         vscode.lm.selectChatModels with flauz-mock vendor
                    preference + graceful no-models
  artifacts.ts      .flauz/artifacts/<task>/ writes + sha256
  seamClient.ts     stdio client for core/service.mjs
  marks.ts          code/flauz/* perf marks (PERF-PLAN §6.2)
test/               node:test, zero dependencies (Node >= 23.6 type
                    stripping; erasable-only TS syntax)
  harness/          fidelity-mapped vscode mock (records registrations,
                    invocations, confirmations, terminals), registerHooks
                    'vscode' redirect, fake workspace seam
vscode-dts/         vendored vscode.d.ts (PROVENANCE line, @9bf9ae764da)
shims/              hand-written ambient Node typings (no @types/node)
```

## The seam (v0 contract)

- Workspace state: `.flauz/tasks.json` (envelope `flauz.tasks/v0`, stable key
  order, 2-space indent, trailing newline) and `.flauz/evidence/ledger.jsonl`
  (append-only rows `{seq, ts, taskId, kind, uri, sha256, prev}`; the row
  hash is sha256 over the canonical JSON of those seven fields; each row's
  `prev` carries the previous row's hash; v0 is hash-chain only — Wave 4 adds
  signatures).
- Commands (F calls, G handles): `flauz.workspace.createTask / appendEvent /
  listTasks / getTask / appendEvidence / createCheckpoint / verifyLedger`,
  plus `ping` / `shutdown`.
- Legal transitions (everything else is rejected with the allowed source
  statuses listed): plan→awaiting-approval (submit-plan, agent);
  awaiting-approval→execute (approve, human); awaiting-approval→plan
  (request-changes, human); execute→verify (report, agent);
  verify→awaiting-signoff (verify-pass, agent|tool); verify→execute
  (verify-fail, agent); execute→failed (fail, agent);
  awaiting-signoff→done (sign-off, human); any-active→cancelled (cancel,
  human).

## Agent OS service boundary (TL2-S1)

`core/serviceBoundary.mjs` is the orchestration-side consumer of the TL1-003
seam (the surge integration layer; see docs/FLAUZ-PROGRAM/SERVICE-SEAM.md -
the AUTHORITATIVE wire spec):

- ZERO duplication (binding): transport is the landed `src/seamClient.ts`
  (composed, never re-implemented; the .mjs imports the .ts as a Node
  type-stripping module - the shipped extension still imports types only);
  version/gating logic is `core/protocol.mjs` (SEAM_METHODS,
  seamMethodVersions, SEAM_PROTOCOL_VERSIONS - never a copied table).
- Start/recover through the native boundary: `AgentOsServiceBoundary.start()`
  spawns the REAL service, negotiates, affirms capabilities + lifecycle;
  `recover()` re-spawns, re-hello, re-negotiates and re-reads state (the
  kill-and-reconnect matrix proves snapshot identity - see
  test/agentOsService.recovery.test.ts).
- Fail-closed, machine-readable failures: every failure is a BoundaryFailure
  with a closed-set `flauz.os.err.*` code, a retryHint and a retryable flag;
  a side-effecting request whose response was lost is OUTCOME-UNKNOWN and is
  never auto-retried - reconcile via snapshot, then a NEW idempotency key
  (the client-side memo replays completed attempts and rejects unknown ones
  fast, so a re-driven attempt can never double-apply on the wire).
- The seam usage map (`core/seamUsageMap.json` + the typed mirror
  `src/seamUsageMap.ts`, deep-equal pinned by test) records which lifecycle
  phases are served today and which need additive protocol extensions
  (orch journal rows, lease ops, recovery scan, journal verify, event
  replay) - proposals only; nothing is implemented behind the registry's
  back.

## Golden path

request → createTask → submit-plan → **/approve** (human) → terminal tool
(`echo flauz-golden-path-ok`) behind a confirmation gate → evidence rows
(command-output + changeset/checkpoint) → report → verify-pass (actor `tool`)
→ **/sign-off** (human) → done. See `test/goldenPath.test.ts`.

## Activation & performance discipline

- `onStartupFinished` + `onCommand:flauz.showTasks|verifyLedger` only
  (PERF-PLAN §2.1; never `*`).
- Marks, in emission order: `code/flauz/willConnectCore` /
  `didConnectCore`, `willRegisterParticipants` / `didRegisterParticipants`,
  `willWarmModels` / `didWarmModels` — only `code/`-prefixed marks are
  aggregated by the timer service (§6.2). Warming is exactly one
  `selectChatModels` call (§2.2).
- Without a workspace folder the bridge degrades gracefully: no core
  service, no participant, one log line (the seam-independent terminal tool
  still registers).

## Proposed APIs (DL-4)

The extension's TS code uses ONLY stable API (`chat.createChatParticipant`,
`lm.registerTool`, `lm.invokeTool`, `lm.selectChatModels`,
`lm.registerLanguageModelChatProvider`, terminal shell integration).
`package.json` declares `enabledApiProposals: []`. The two proposals the
STATIC contribution needs — `defaultChatParticipant` (gates
`chatParticipants[].isDefault`, chatParticipant.contribution.ts:268) and
`chatParticipantAdditions` (gates `locations`/`modes`, :273) — are
force-enabled for this built-in via `product.flauz.json`'s
`extensionEnabledApiProposals` (the product list REPLACES the extension's
own declaration, extensionsProposedApi.ts:80-102). That is the
enable-for-built-ins, zero-promotion posture: the requirement is documented
here and in the REPORT, never blindly enabled in the manifest.

## Extension-host affinity (operator setting)

To pin the bridge onto its own extension host (AHP semantics, DL-5), set:

```json
"extensions.experimental.affinity": { "flauz.flauz-agent": 1 }
```

Shape verified at HEAD: declared `extensions.contribution.ts:269-285`
(object of `publisher.name` → positive integer, no explicit scope); read at
`extensionRunningLocationTracker.ts:167` with positive-int validation
(:172-175); honored only at INITIAL allocation (:196-198), ignored in
extension-development mode (:165); result is a
`LocalProcessRunningLocation(affinity)` (:277). v0 does not force this
setting from the product overlay — it is an operator opt-in documented here.

## Checks (zero-install)

```
/home/z/my-project/node_modules/.bin/tsc --noEmit -p <this tsconfig>
node --test test/*.test.ts
```

TypeScript is the only dev-dependency and is NOT installed in-tree (sandbox
discipline: reuse the host toolchain). Tests run directly on the `.ts`
sources via Node type stripping; the only runtime dependency is Node itself.

## Packaging (CI side, out of sandbox scope)

`main` is `./dist/extension.js`; CI bundles with esbuild (ESM output — the
package is `"type": "module"`) and must ship `core/service.mjs` next to the
bundle (the client derives its path from `import.meta.url`). Building the
vscode repo and running a real IDE are explicitly OUT OF SCOPE in the
sandbox (MIGRATION-PLAN §5).

## v0 simplifications (see REPORT §CONTRACT-DEVIATIONS / §GAPS-AND-SKIPS)

One active task per orchestrator (no chat-history persistence); deterministic
plan text (model attribution only, no `sendRequest`); `fail` is legal only
from `execute`; evidence `note` accepted but not persisted in v0 rows;
`evidenceId` is `E-<seq>`; artifacts live under `.flauz/artifacts/` with
workspace-relative URIs; `createCheckpoint` returns `null` for terminal
tasks (fabricated content-addressed refs otherwise).
