# build/flauz/dogfood/ — the A-PROD-003 dogfood harness (W1 + W2.1 realism fixes + W3.1 + W3.2 + W6 exercise design + W7 agent-with-tools + W8 deeper-dogfood)

The W1 harness for A-PROD-003 (dogfooding): the driver machinery + the
friction-log contract + the exercise lanes that the station then runs
for real in **W2 (live provider, station-side)**. Built on the
journey-drill pattern (`build/flauz/journey/journey.drill.ts`): it
imports the REAL product seams directly, constructs real
Agent OS / Model Fabric / Workspace OS / evidence-ledger objects, and
drives scripted-but-real scenarios with per-exercise receipts.

Everything here is additive harness code under `build/flauz/dogfood/**`.
Nothing here is a gate instrument; nothing here edits one.

**W2.1 (A-PROD-003-W2.1, branch flauz-tla/aprod003-w21-dogfood-realism)**
implements the three REGISTERED W2 dogfood findings as harness-side
fixes (P2-FIX-117/118/119; finding docs in docs/FLAUZ-PROGRAM/findings/):

- **P2-FIX-117 (budget):** the driver's ask lane grows
  `FLAUZ_DOGFOOD_WALL_CLOCK_BUDGET_MS` (env-only, OPTIONAL, fail-closed
  on a malformed value; default 15 000 ms — unchanged, the fake lanes
  behave exactly as in W1 when the knob is absent). It is wired through
  the product's EXISTING wall-clock budget surface for the ask —
  `AdapterConfig.requestTimeoutMs`
  (extensions/flauz-models/src/adapters/common.ts) — the field the real
  openAiCompat adapter turns into the request `timeoutMs` whose expiry
  maps onto the TYPED TIMEOUT ("request exceeded its wall-clock budget").
  The typed TIMEOUT semantics (bounded retry) are UNCHANGED; only the
  budget value is configurable. Ask-measuring timing rows and the run
  summary record the budget actually used.
- **P2-FIX-118 (fenced answers):** the answer-verification layer accepts
  a leading/trailing markdown fence around JSON payloads for LIVE lanes
  (strip-fence-then-parse in answerFence.ts; malformed JSON inside the
  fence still FAILS; the raw-JSON path stays the machine-lane default).
  Unit tests cover fenced / malformed-fenced / raw shapes.
- **P2-FIX-119 (unanswerable question):** the provider-switch exercise
  carries the workspace facts IN the prompt (the verbatim providers
  file content + the routing-decision tail + the total count, embedded
  AT ASK TIME — inside the ask window, after the ask's own durable
  routing decision) and asks the model to report them faithfully. The
  verification stays strict; the fake lane's server-side computation
  path for this question is RETIRED (both lanes answer from the
  prompt-carried facts — the god-view is gone).

**W3.1 (A-PROD-003-W3.1, branch flauz-tla/aprod003-w31-fence-extract)**
implements the REGISTERED W3 live finding P2-FIX-120 (finding doc in
docs/FLAUZ-PROGRAM/findings/) as a harness-side fix:

- **P2-FIX-120 (prose-adjacent fenced answers):** the live model emits
  the fenced JSON **surrounded by prose** ("```json {...} ``` Success!"),
  and the W2.1 stripper only strips a fence pair that ENDS the text. The
  fence-tolerant path (live lanes) now: clean-pair strip FIRST (the
  W2.1 semantics, back-compat — `stripMarkdownJsonFence` is UNCHANGED),
  then the extraction fallback `extractFirstFencedJsonBlock` — the
  FIRST COMPLETE fenced block (a fence-opening line, content, a
  matching fence-closing line) from ANYWHERE in the text; prose
  before/after is allowed. Malformed JSON inside the extracted block
  still FAILS; a text with NO complete fence still falls to the raw
  parse (the honest failure); the raw-JSON machine-lane default is
  unchanged.

**W3.2 (A-PROD-003-W3.2, branch flauz-tla/aprod003-w32-live-budget)**
implements the REGISTERED W4 live finding P2-FIX-121 (finding doc in
docs/FLAUZ-PROGRAM/findings/) as a harness-side fix:

- **P2-FIX-121 (the live truncation budget):** the platform's default
  completion budget (~4096 tokens) truncated the real 23-consumer
  exploration map mid-JSON (`finish_reason: length` at
  `completion_tokens: 4095`, the opening fence without the closing).
  The driver's LIVE-lane ask request now sets an explicit completion
  budget — the env-only, OPTIONAL knob
  `FLAUZ_DOGFOOD_LIVE_MAX_TOKENS` (default **32 768** tokens, parsed
  fail-closed: a malformed value exits 2) — wired through the
  product's EXISTING request surface `ChatRequest.maxOutputTokens`,
  the field the REAL openAiCompat adapter maps onto the wire body's
  `max_tokens` (`buildOpenAiRequestBody`, extensions/flauz-models/src/
  adapters/openAiCompat.ts). The **fake lanes' request shape is
  UNCHANGED** (the knob lands on live-lane ask requests only — no
  `max_tokens` field on fake/scripted-lane asks). The ask's ok-result
  and the exercise receipts surface the **finish reason** (the
  adapter's terminal `finish` event): every ok ask's detail carries
  `finish_reason: <r>`, and a `length` finish renders as the VISIBLE
  **`TRUNCATED`** marker in the receipt details (the run summary
  records the budget block `liveCompletionBudget`). Acceptance: the
  live exploration run's answer parses, or fails with a VISIBLE
  truncation marker — never a bare raw-parse error again.

**W6 (A-PROD-003-W6, branch flauz-tla/aprod003-w6-exercise-design)**
implements the REGISTERED W5 live finding P2-FIX-122 (finding doc:
docs/FLAUZ-PROGRAM/findings/P2-FIX-122-bare-model-exploration-unanswerable.md)
as a harness-side exercise-design fix:

- **P2-FIX-122 (the exploration exercise demands a capability a bare
  live model cannot have):** the W5 live run proved the harness
  machinery fully live-capable — and the exploration knowledge checks
  failed HONESTLY (0/7 sound, 23/23 missed: the model cannot see the
  20k-file tree; its seven plausible entries were hallucinations).
  The exercise now SPLITS BY LANE:
  - the **fake lane keeps the full-tree question and the full-tree
    verification, UNCHANGED** — its server-side scan (fake-provider.mjs)
    IS the ground truth for the machinery (the G4 driver run);
  - the **live (bare-model) lane grows the EXCERPT mode**: the ask-time
    prompt builder (the P2-FIX-119 discipline — built INSIDE the ask
    window, after the ask's own durable routing decision, right before
    the request ships) embeds a **tree EXCERPT**: `buildTreeExcerpt` — a
    deterministic, seeded (mulberry32, `EXCERPT_SEED = 1220`), capped
    (`EXCERPT_FILE_COUNT = 64` files of the ~370 flauz-* sources)
    selection of files' import lines from the driver's own scan, with a
    **consumer guarantee** (whenever the tree has ledger consumers, the
    excerpt carries at least one — the alphabetically-first consumer
    file joins a selection that would miss them all; never a vacuous
    test). The question becomes **"report the ledger consumers among
    THIS excerpt's lines"** (the same operational definition + answer
    schema, scoped to the excerpt; the question never carries the fake
    lane's full-scan trigger phrase).
  - the **verification is excerpt-scoped**
    (`verifyExcerptConsumersMap`): every claimed entry must re-read
    WITHIN the excerpt (its file:line is an excerpt row, the row REALLY
    imports the ledger module, the symbols match the row's bindings)
    and every excerpt consumer must be claimed — **the same 100% bar,
    judged against the excerpt embedded in the prompt** (a REAL tree
    consumer outside the excerpt fails as out-of-scope; a hallucinated
    entry fails soundness; a missed excerpt consumer fails
    completeness). Pure function over the answer + the banked excerpt
    — no tree reads: the excerpt is this lane's ground truth.
  - **the excerpt is banked into the exercise receipt**: a hash-pinned
    workspace artifact (`.flauz/artifacts/<task>/explore-excerpt.json`)
    AND embedded in the verification receipt
    (`flauz.dogfood-explore-excerpt-verification/v1`, written to the
    records dir as `explore-repo.verification.json`) — a reviewer can
    check the model's answer against the excerpt BY HAND.
  - the receipt keeps the SAME check ids as W5 (`explore.map-sound` /
    `explore.map-complete` / `explore.map-100-percent` — the live
    receipt reads exactly like the W5 one, scoped to the excerpt) plus
    the new `explore.excerpt-embedded` (the ask prompt is CHECKED to
    carry the excerpt verbatim — checked, not trusted).
  - the **agent-with-tools lane is deferred** to the tools dogfood wave
    (the browser/environment/multi-agent dimensions where the model can
    actually read the tree) — per the finding's candidate acceptance.

  The station's live W6 run (the env contract present) is the
  live-lane verification of this design; the worker's G4 receipt is
  the fake-lane run (the credential-free law — live evidence is
  claimed only by the station).

**W7 (A-PROD-003-W7, legs 1+2 — the browser-policy exercise landed first
as PR #156 `7ca629fbd40`, then exercises 3+4 on the post-leg-1 head)**
implements the DEFERRED agent-with-tools lanes (the P2-FIX-122
candidate acceptance's tools lane + the remaining dogfood dimensions:
multi-agent delegation, approvals/takeover, implementation/tests as
dogfooded work) — TWO new exercises, additive harness code only:

- **EXERCISE 3 — `agent-delegation`:** drives the REAL flauz-agent
  orchestration pipeline the way the product's own golden path does
  (`extensions/flauz-agent/test/goldenPath.test.ts` +
  `takeover.p2fix204.test.ts` — the sanctioned test-time cross-extension
  imports): the REAL core-service child process over stdio, the REAL
  orchestrator/participant/`flauz_terminal`-tool wiring (the fidelity
  vscode mock's `lm.invokeTool` implements the platform's HumanApproval
  gate — the tool's REAL `prepareInvocation` → `confirmationMessages` →
  the confirmation policy), and a PRODUCTION-SHAPED terminal (a real
  `/bin/sh -c` child on a real cwd — the terminal factory the tool's own
  deps contract designs for injection). The arc: the golden path WITH a
  refusal leg (the human DENIES the first tool confirmation → the task
  fails fail-closed with NO evidence rows → a fresh task whose approved
  execution REALLY runs the golden command → command-output + changeset
  evidence rows → verify-pass → sign-off); a DELEGATION edge (an
  orchestration graph whose step passes the step-level approval gate,
  then the real composed ops `delegateStep`/`ingestResultReport` from
  `core/routing.mjs`: route-decided + startStep + the typed a2a
  task-delegation message posted through the REAL service's `flauz.a2a`
  seam + the delegation-sent receipt); a SECOND agent session (the
  worker: mailbox collection + session-tier memory + the exclusive
  claim) performing a REAL implementation-and-test act (it authors a
  scratch module + test and runs the test through the approved tool
  invocation, evidencing the output as a command-output ledger row); and
  a TAKEOVER transition (a gated step stuck on a pending approval,
  taken over through the participant `/takeover` command → the real
  takeover port → request → accept → complete, every journal row actor
  `human`, the step NEVER started by an agent). EVERY human intervention
  (each approval, each confirmation — granted AND denied — each
  sign-off, the takeover) is a first-class `manual-intervention` friction
  row; the two recoveries (the denial's re-run, the takeover's
  completion) carry their recovery accounts. Receipts:
  `agent-delegation.report.json` (the full session report embedding the
  three tool receipts R-1 denied / R-2 golden / R-3 delegated test run),
  the friction log, and the driver-level evidence (the report + the
  session-state bundle — the orchestration journal + the a2a journal +
  the evidence ledger, verbatim).
- **EXERCISE 4 — `tools-exploration` (the deferred P2-FIX-122 full-tree
  question, agent-with-tools):** the exploration exercise that asks for
  EVERY consumer of the evidence ledger across the real ~20k-file tree —
  THROUGH THE TOOL-CARRYING LANE: the ask carries the real tool surface
  (the `flauz_terminal` tool: file read/search as commands, every
  invocation through the approved invocation path — the HumanApproval
  gate in front), the agent answers by DIRECTING tool calls in a bounded
  turn loop (a tool-call directive JSON or the final answer JSON —
  fence-tolerant on live lanes), and its answer MUST cite what it
  ACTUALLY read: the dogfood tool receipts (schema
  `flauz.dogfood-tool-receipt/v1`, one per approved invocation:
  approval asked/granted + the real execution's exit code + the hashed
  stdout + the minted ledger row). The verification stays the driver's
  INDEPENDENT ground-truth scan (`scanLedgerConsumers` +
  `verifyConsumersMap` — the SAME sound+complete 100% bar as the fake
  lane's full-tree check; the map CHECKED, never trusted) PLUS the
  tool-receipt contract check (`verifyToolsReceipts`: every claimed
  consumer covered by a READ receipt whose real execution streamed that
  file:line, every cited receipt approved with exit 0 — a hallucinated
  consumer fails exactly as W5 proved it must). The fake lane's agent
  brain lives in `fake-provider.mjs` (`toolsAgentTurn`: the scripted
  search-then-read-then-answer policy — a SOUND superset search
  (`grep -rlE` for relative `from '…ledger'` specifiers) followed by
  numbered-line reads of every candidate; the answer is computed FROM
  THE TOOL RESULTS carried in the conversation — never a server-side
  scan, the W2 god-view stays retired; never canned). The live lane
  (station-side) speaks the same text protocol against a real vendor —
  the model gets the tools and must genuinely use them. Receipts:
  `tools-exploration.verification.json` (the checked map + the
  receipt-contract verification + every tool receipt, embedded), the
  friction log, and the driver-level evidence (the answer + the
  verification + every receipt's transcript, hash-pinned).

**environments-lifecycle** (W8, A-PROD-003-W8) — the deeper-dogfood
environments lane: a REAL `EnvironmentRegistry` + the REAL
`LocalProcessExecutor` (the FIXED `fixtures/env-agent.ts` harness — the
ONLY sanctioned executable; descriptor-supplied execution is forbidden)
spawned as a REAL child process with the stdio ready-line handshake,
driven through the REAL `EnvironmentLifecycleManager` over the PIN-2
siblings (`.flauz/environments-lifecycle.json` +
`.flauz/environments-ops.jsonl`). The typed state machine is asserted at
EVERY step (registered -> created -> running -> `running/attached` ->
snapshot-preserving -> stopped -> destroyed); the failure legs are the
typed ILLEGAL_TRANSITION (stop on a destroyed id) and the fail-closed
TRUST_POSTURE_REJECTED (an untrusted-posture start); the ops ledger is
asserted append-only (one canonical row per op, provenance actor
recorded) and the PIN-2 envelope shape pinned (the exact entry key set
+ the lastOpRef invariant). The P2-FIX-119 ask embeds the op-sequence
facts at ask time (the ledger rows verbatim); the driver verifies the
answer INDEPENDENTLY against the real manager's entries()/ops() (the
map CHECKED, never trusted). Receipts:
`environments-lifecycle.report.json`, the friction log (4
manual-intervention rows, 2 with recovery accounts), and the
driver-level evidence rows.

**workspace-continuity** (W8, A-PROD-003-W8) — the deeper-dogfood
continuity lane: the REAL `ContinuityManager` (export -> carry ->
restore -> verify -> status) over the closed 22-surface canon (the
N-8 16-surface canon + the 6 post-canon state surfaces, CLOSED and
deterministic) + the append-only hash-chained ops ledger
(`flauz.continuity-ops/v0`). The REAL `.flauz/` source state is built
through REAL product seams (a TaskService task envelope, EvidenceLedger
rows with the fixture ed25519 signer, MemoryStore records, the models
providers file, the environments registry envelope, and a browser
session journal record whose navigation URL is at-record redacted).
The SECRET-REDACTION LAW is checked, never trusted: the captured-class
surfaces (evidence ledger + artifacts + browser journal) export as
typed `redacted` entries — presence + sha256 of the PATH, the payload
NEVER copied — and restore NOTHING on the target. The legs: the fresh-root
restore (byte-identical carried payloads), the un-gated restore onto
the non-empty target (the typed RESTORE_TARGET_NOT_EMPTY), the
force-gated re-restore, the tamper leg (one bundle artifact tampered on
the target -> the per-surface `mismatch` verdict + VERIFY_FAILED), and
the export defense-in-depth leg (a runtime-assembled canary planted in
a carried `never`-class surface -> EXPORT_SECRET_DETECTED, fail-closed,
the bundle never committed). The P2-FIX-119 ask embeds the surface-map
facts at ask time; the driver verifies the answer INDEPENDENTLY against
the real manifest + the real restore result. Receipts:
`workspace-continuity.report.json`, the friction log (4
manual-intervention rows, 3 with recovery accounts), and the
driver-level evidence rows.

## Files

| File | Role |
|---|---|
| `dogfood-driver.mjs` | THE DRIVER: boots the real seams on one mkdtemp workspace root (TaskService, EvidenceLedger + the fixture ed25519 signer, MemoryStore, OrchestrationStore, Model Fabric) and executes the exercise scripts against them. Selectable provider lanes. Writes the run receipts. |
| `frictionlog.mjs` (+ `frictionlog.d.mts`) | The friction-log contract, schema `flauz.dogfood-friction/v1` (append-only JSONL; ask-measuring timing rows carry the optional `wallClockBudgetMs`, P2-FIX-117). The `.d.mts` is the hand-written declaration (the repo's `a2a.d.mts` zero-dependency discipline). |
| `answerFence.ts` | P2-FIX-118 + P2-FIX-120: the fence-tolerant parse resolution — the W2.1 clean-pair strip (`stripMarkdownJsonFence`, UNCHANGED: one leading/trailing markdown fence pair around a JSON payload) plus the W3.1 extraction fallback (`extractFirstFencedJsonBlock`: the first COMPLETE fenced block from anywhere in the text; prose before/after allowed) composed by `fenceTolerantParseBody` (clean-pair first, then extraction; malformed JSON inside still fails; the raw path stays the machine-lane default). |
| `fake-provider.mjs` (+ `fake-provider.d.mts`) | The fake/scripted provider lanes on a REAL local socket. The fake lane COMPUTES its exploration answer at request time (the ledger-consumer map from the real tree) and READS its provider-configuration answer from the prompt-carried facts (P2-FIX-119: the server-side computation path is retired). The scripted-failing lane answers every completion with HTTP 500 -> the REAL adapter's typed `PROVIDER_OVERLOADED`. The `.d.mts` is the hand-written declaration for the test suite. |
| `harnessTypes.ts` | The harness/exercise contracts (typed against the real seam modules; the ask facade accepts an ask-time prompt builder, P2-FIX-119, and the ask outcomes carry `wallClockBudgetMs`, P2-FIX-117, + `finishReason`, P2-FIX-121). |
| `liveBudget.mjs` (+ `liveBudget.d.mts`) | P2-FIX-121: the live completion-budget knob (`FLAUZ_DOGFOOD_LIVE_MAX_TOKENS`, default 32 768, pure fail-closed parser `parseLiveMaxTokens`) + the finish-reason surfacing (`consumeAskStream` — the ask-stream consumption joining the text deltas AND capturing the terminal finish event's reason; `finishReasonDetail`/`answerParseFailDetail` — a `length` finish renders as the VISIBLE TRUNCATED marker). The `.d.mts` is the hand-written declaration (the frictionlog.d.mts zero-dependency discipline). |
| `exercises/explore-repo.task.ts` | EXERCISE 1 (repository exploration): the question, the driver-side INDEPENDENT scanner + verifier, the exercise (live-lane answers parse through the P2-FIX-118 tolerant path; P2-FIX-122: the live lane answers the EXCERPT-mode question — `buildTreeExcerpt`/`buildExcerptQuestion`/`verifyExcerptConsumersMap`, the excerpt-scoped 100% bar, the banked excerpt; the fake lane keeps the full-tree question, UNCHANGED). |
| `exercises/provider-switch.task.ts` | EXERCISE 2 (provider switching + failure/recovery): the switch plan, the ask-time facts-carrying question builder (P2-FIX-119), the workspace-state verification (strict, unchanged), the friction policy, the exercise. |
| `agentTools.ts` | W7: the REAL tool-carrying surface both new exercises drive — the fidelity vscode mock (the sanctioned test-time cross-extension import) + the REAL `flauz_terminal` tool registered against it with a PRODUCTION-SHAPED terminal factory (a real `/bin/sh -c` child on a real cwd), the confirmation-gate recording (every asked/granted/denied decision verbatim), and the dogfood TOOL-RECEIPT contract builder (`flauz.dogfood-tool-receipt/v1`). |
| `exercises/agent-delegation.task.ts` | W7 EXERCISE 3 (multi-agent delegation + approvals/takeover + implementation/tests as dogfooded work): the golden path with its refusal leg, the delegation edge over the real a2a/orchestration seams, the worker session's real implementation-and-test act, the takeover transition, the 10 human-gate friction rows, the session report + the session-state evidence bundle. |
| `exercises/tools-exploration.task.ts` | W7 EXERCISE 4 (the deferred P2-FIX-122 full-tree question, agent-with-tools): the tool-carrying protocol (the ask prompt + the tool-results conversation + the directive/answer schemas), the bounded turn loop, the receipt-contract verification (`verifyToolsReceipts`), the driver-side ground-truth verification (reused from explore-repo), the exercise. |
| `exercises/browser-policy.task.ts` | W7 LEG 1 (the browser-work dogfood exercise, PR #156): BrowserPolicyEngine's B1c firing model (the agent path driver+webRequest, the user path willNavigate+webRequest), FakeBrowserState/FakeCdpTransport over CdpEndpointHost, the tab pipeline, the in-memory session journal, the at-record URL redaction — the scripted matrix n1..n7 + the drop/recovery drill. |
| `exercises/environments-lifecycle.task.ts` | W8 EXERCISE 5 (the deeper-dogfood environments-lifecycle lane): the REAL EnvironmentRegistry + LocalProcessExecutor (the FIXED env-agent.ts harness — the ONLY sanctioned executable — spawned as a REAL child with the stdio ready-line handshake) + EnvironmentLifecycleManager over the PIN-2 siblings: the typed state machine asserted at every step (registered -> created -> running -> running/attached -> snapshot-preserving -> stopped -> destroyed), the real sha256 snapshot manifest, the illegal-transition + trust-gate failure legs, the append-only ops ledger + the envelope shape pins, and the P2-FIX-119 ask over the op-sequence facts (verified independently against the real manager entries()/ops()). |
| `exercises/workspace-continuity.task.ts` | W8 EXERCISE 6 (the deeper-dogfood workspace-continuity lane): the REAL ContinuityManager (export -> carry -> restore -> verify -> status) over the closed 22-surface canon + the hash-chained ops ledger, with the REAL .flauz/ source state built through the REAL TaskService/EvidenceLedger/MemoryStore/writeProviderOverrides/EnvironmentRegistry/FileSystemSessionJournal seams; the SECRET-REDACTION LAW (presence + path hash, the payload NEVER), the fresh-root restore + the force gate, the un-gated + tamper/VERIFY_FAILED + EXPORT_SECRET_DETECTED failure legs, the G8 runtime-assembled canary law, and the P2-FIX-119 ask over the surface-map facts (verified independently against the real manifest + restore result). |
| `dogfood.test.ts` | The mocha tdd suite (the friction-log schema + the exercise verification logic + the W2.1 suites: P2-FIX-117 timing-row budgets, P2-FIX-118 fenced/malformed-fenced/raw shapes, P2-FIX-119 prompt-carried facts round-trip; + the W3.1 suite: P2-FIX-120 trailing-prose/leading-prose/clean-fence/multiple-fences/no-fence/malformed-inside-fence + the module unit tests; + the W3.2 suites: P2-FIX-121 the knob's default/env/fail-closed parsing + the finish-reason surfacing incl. the fixture-level scripted stream carrying finish_reason `length` through the REAL adapter → the VISIBLE TRUNCATED marker in the receipt detail; + the W6 suites: P2-FIX-122 the excerpt builder's determinism/seed-sensitivity/consumer-guarantee, the excerpt-scoped verification logic (fixture excerpts with known consumers — hallucination detection against the excerpt, the completeness bar), the question/prompt round-trip, and the exercise's excerpt-mode wiring in live-provider mode incl. the fake-lane-unchanged pins; + the W7 suites: the real tool surface + the tool-receipt contract shapes (executed/denied), the golden path + the approval-gate refusal over the REAL session machinery, the delegation edge + the takeover transition over the real orchestration seams, the delegation exercise wiring (the 10 human-gate friction rows), the tools-lane protocol parsing (raw + fenced), the receipt-contract verification logic (coverage/hallucination/denied/failed citations), the scripted agent brain's turn policy, the provider branch over the real SSE wire, the tools exercise wiring (happy path + the hallucinating stub + the refusing human + the unknown tool) and the G8 privacy-canary pins for both lanes). |
| `environments-continuity.dogfood.test.ts` | The W8 sibling mocha tdd suite (the browser-policy.dogfood.test.ts precedent): the answer-parser mutation matrices for BOTH lanes (swapped verdict/final state, fabricated entries, wrong schema each FAIL), the marker-protocol failures (missing + unterminated facts sections, malformed facts), the state-machine legality pins against the REAL product transition table, the secret-redaction law + the closed canon + the G8 committed-literal scan, the two fake-lane answer computations + the provider branches over the real SSE wire, the full exercise wiring for BOTH lanes (pinned check ids + friction censuses + the legs census), and the driver's seven-exercise registration pin. |

## How to run

```sh
node --experimental-strip-types build/flauz/dogfood/dogfood-driver.mjs \
     [--repo <dir>]      # default: the repo containing this harness
     [--out <dir>]       # default: <workspace-root>/.flauz/dogfood-records
     [--exercise <id>]   # explore-repo | provider-switch | browser-policy | agent-delegation | tools-exploration | environments-lifecycle | workspace-continuity (default: all seven)
```

Exit `0` = every selected exercise PASSes (the G4 shape: every friction
log non-empty-or-honest, the explore-repo map 100% verified, the seven
exercise verdicts PASS). Exit `1` = an exercise verdict FAILed (read
the receipts). Exit `2` = usage / fail-closed env-contract error.

## Modes and the env-variable contract (the credential-free law)

- **fake-lane (default, no env):** the model intelligence is the
  fake/scripted provider lane — **fixture level, claimed exactly so,
  never wording-promoted**. The seams it drives are real (local-real);
  the exploration answer is computed live from the tree by the local
  wire server, the provider-configuration answer is read from the
  prompt-carried facts (P2-FIX-119), and the driver VERIFIES them
  (checked, not trusted).
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

- **the ask wall-clock budget (P2-FIX-117, any mode):** the OPTIONAL
  env-only knob

  ```sh
  FLAUZ_DOGFOOD_WALL_CLOCK_BUDGET_MS=<positive-integer-ms>
  ```

  sets the wall-clock budget for every ask, wired through the product's
  existing budget surface (`AdapterConfig.requestTimeoutMs` → the real
  adapter's request `timeoutMs` → the TYPED TIMEOUT on expiry, bounded
  retry unchanged). Absent → the default 15 000 ms (the W1 behavior,
  unchanged for the fake lanes). Malformed (non-positive-integer) →
  FAIL CLOSED (exit 2). Ask-measuring timing rows carry the budget
  actually used as `wallClockBudgetMs`; the run summary records
  `wallClockBudget: { configuredMs, defaultMs, source, wiredThrough }`.

- **the live-lane completion budget (P2-FIX-121, live-lane asks):** the
  OPTIONAL env-only knob

  ```sh
  FLAUZ_DOGFOOD_LIVE_MAX_TOKENS=<positive-integer-tokens>
  ```

  sets the explicit completion budget on the LIVE lane's ask requests,
  wired through the product's existing request surface
  (`ChatRequest.maxOutputTokens` → the real openAiCompat adapter's wire
  body `max_tokens`; the platform default ~4096 truncated the real
  exploration map mid-JSON — finish_reason `length`). Absent → the
  generous default 32 768 tokens. Malformed (non-positive-integer) →
  FAIL CLOSED (exit 2). The fake lanes' request shape is UNCHANGED (the
  knob lands on live-lane asks only); the run summary records
  `liveCompletionBudget: { configuredTokens, defaultTokens, source,
  wiredThrough }`. Every ok ask's receipt detail surfaces the finish
  reason; a `length` finish renders as the VISIBLE `TRUNCATED` marker.

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
  type:"timing", ts, phase, durationMs}` plus the OPTIONAL
  `wallClockBudgetMs` (P2-FIX-117) on ask-measuring rows: the
  wall-clock budget that governed the ask the row measures. Rows that
  measure driver-side work (no ask) carry no budget; rows without the
  field (the pre-W2.1 shape, e.g. the banked W2 records) still
  validate — the field is additive and optional.

Friction is recorded HONESTLY: only what actually happens during the
run (a typed provider failure, a failed verification, a recovery). The
harness does not fabricate friction events; build-time observations
belong in the wave report, not the run log.

## The exercises and their receipts

**explore-repo** — the question SPLITS BY LANE (P2-FIX-122): the fake
lane asks *"map every consumer of the evidence ledger across
extensions/flauz-\*: file + line + what it consumes"* (operational
definition pinned inside the prompt) — the provider answers by
scanning the real tree at request time; the driver independently
scans (its own regex scanner), re-reads every claimed `file:line`, and
requires 100% soundness AND completeness. The live lane asks the
EXCERPT-mode question (*"report the ledger consumers among THIS
excerpt's lines"*) — the deterministic tree excerpt is embedded in the
prompt at ask time and the same 100% bar is judged against the
excerpt (the banked excerpt + the answer + the verification receipt
are hash-pinned; a reviewer can check the model's answer against the
excerpt by hand). Receipts:
`explore-repo.verification.json` (the checked map — in live mode the
excerpt-mode receipt embedding the excerpt),
`explore-repo.receipt.json`, the friction log, two hash-pinned
evidence rows (three in live mode: + the excerpt artifact).

**provider-switch** — the sequence `healthy -> scripted-failing ->
healthy`, each switch = the real providers-file enablement act + the
routing-policy rewrite + a fresh registry load + a durable routing
decision + ONE evidence row per switch (G5). The failing lane's typed
`PROVIDER_OVERLOADED` (retryable, short-backoff) feeds the product's
own bounded-retry bound (`resolveProviderRetryBound`); the recovery
switch proves the same call type succeeds again. The healthy-lane
question is built AT ASK TIME with the workspace facts embedded in the
prompt (P2-FIX-119: the verbatim providers file content + the
routing-decision tail + the total count; the model's job is reading +
faithful reporting), and the answers are verified STRICTLY against the
workspace's real model-state files (checked, never trusted; live-lane
answers parse through the P2-FIX-118 fence-tolerant path — the report
records `askPromptRedacted` + `promptFacts` per switch as the receipt).
Receipts: `provider-switch.report.json`, `provider-switch.receipt.json`,
the friction log (the typed provider-failure row WITH its recovery
account = the recovery row).

`run-summary.json` (schema `flauz.dogfood-run/v1`) carries the whole
run: mode, the wall-clock budget block (P2-FIX-117), the live
completion-budget block `liveCompletionBudget` (P2-FIX-121),
per-exercise verdicts/assertions/evidence ids/friction
census, and the local-lane wire census (`chatCalls`, `failCalls`,
`exploreComputations`, `configPromptReads` — the provider-configuration
prompt-fact reads, P2-FIX-119).

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
  npm i --silent --no-audit --no-fund mocha@11 tsx
cd <repo-root>
NODE_OPTIONS="--import file:///tmp/labrun/node_modules/tsx/dist/loader.mjs" \
  /tmp/labrun/node_modules/.bin/mocha --ui tdd \
  build/flauz/dogfood/dogfood.test.ts \
  build/flauz/dogfood/browser-policy.dogfood.test.ts \
  build/flauz/dogfood/environments-continuity.dogfood.test.ts
```

(The lab pins are binding: mocha@11 + the tsx loader; typescript 5.9.3
for the G7 typecheck — a newer typescript is drift.)

## The scoped typecheck (the G7 recipe)

Isolated typescript (5.9.3 — the pin), never a repo install;
`--types node,mocha` for the test files; typeRoots outside the repo;
the dogfood file set + `shims-node-g7.d.ts` + the flauz-agent
vscode-dts in the program:

```sh
mkdir -p /tmp/tsclab && cd /tmp/tsclab && npm init -y >/dev/null && \
  npm i --silent --no-audit --no-fund @types/node @types/mocha
tsc --noEmit --target ES2022 --lib ES2022 --module NodeNext \
    --moduleResolution NodeNext --allowImportingTsExtensions --strict \
    --skipLibCheck --types node,mocha \
    --typeRoots /tmp/tsclab/node_modules/@types \
    build/flauz/dogfood/harnessTypes.ts \
    build/flauz/dogfood/agentTools.ts \
    build/flauz/dogfood/exercises/explore-repo.task.ts \
    build/flauz/dogfood/exercises/provider-switch.task.ts \
    build/flauz/dogfood/exercises/browser-policy.task.ts \
    build/flauz/dogfood/exercises/agent-delegation.task.ts \
    build/flauz/dogfood/exercises/tools-exploration.task.ts \
    build/flauz/dogfood/exercises/environments-lifecycle.task.ts \
    build/flauz/dogfood/exercises/workspace-continuity.task.ts \
    build/flauz/dogfood/dogfood.test.ts \
    build/flauz/dogfood/browser-policy.dogfood.test.ts \
    build/flauz/dogfood/environments-continuity.dogfood.test.ts \
    build/flauz/dogfood/shims-node-g7.d.ts \
    extensions/flauz-agent/vscode-dts/vscode.d.ts
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
