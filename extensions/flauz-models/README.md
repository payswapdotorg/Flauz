# flauz-models

Flauz model provider fabric (Wave 3 Lane F seed; **TL2-002 real model/provider
adapters + routing**, Worker B). This built-in extension owns the
model/provider/tool fabric of Flauz on top of the PRESERVED vscode
language-model surfaces: one deterministic mock vendor that stays a mock, three
REAL wire-family adapters that are FIXTURE-VERIFIED, a durable capability
registry with discovery + declarative routing, model-aware context budgets and
an MCP/tool policy posture.

Everything network-bearing in this extension is verified against LOCAL
zero-dependency fixture servers (`node:http` on 127.0.0.1). Live-provider
verification is an explicit future integration gap -- nothing here claims it.

## What it provides

### flauz-mock -- deterministic echo model (live, stays a MOCK)

Unchanged from the Lane F seed: registered through the STABLE API
`vscode.lm.registerLanguageModelChatProvider` (vendored `vscode.d.ts:20851`)
under vendor `flauz-mock` (also declared via the `languageModelChatProviders`
contribution; the d.ts note at `vscode.d.ts:20846` requires the two to stay in
sync). Serves `echo-1`, echoes the last user text in deterministic chunks,
`provideTokenCount` is a character-count approximation. Labeled `mock` in every
surface that mentions it.

### The adapter contract (src/contract/)

Vendor-neutral and BINDING for every adapter: the `ProviderAdapter` port
(capability declaration per model, health probe, streaming request/response
mapping, cancellation, deterministic token estimation), tagged neutral chat
shapes that MIRROR the vscode language-model surfaces, the error taxonomy
(14 codes with a FIXED retryable/terminal table -- the shared seam for Worker
A's retry policy), the injected ports (streaming `HttpPort`,
`SecretResolverPort`, `FileSystemPort`, `Clock`, `HashPort`) and the
production `nodeHttpPort` (global fetch, abort classification
timeout-vs-signal). NO vendor SDKs, NO model-vendor coupling: adapters speak
vendor HTTP shapes only.

### Real adapters (src/adapters/) -- FIXTURE-VERIFIED

Three wire families, all production-shaped, all drilled against local fixture
servers (`test/fixtureServer.ts` + `test/fixtures/vendorPayloads.ts`):

| Adapter | Wire family | Streaming | Health | Auth |
|---|---|---|---|---|
| `openAiCompat.ts` | OpenAI-compatible chat-completions (`POST {base}/chat/completions`) | SSE `data:` frames, `[DONE]` sentinel, index-accumulated `tool_calls`, `stream_options.include_usage` | `GET {base}/models` | `Authorization: Bearer` from the credential ref |
| `anthropicCompat.ts` | Anthropic-compatible messages (`POST {base}/v1/messages`) | Named SSE events (message_start / content_block_* / message_delta / message_stop / ping / error), `input_json_delta` tool fragments, usage split across frames | `GET {base}/v1/models` | `x-api-key` + `anthropic-version` from the credential ref |
| `ollama.ts` | Ollama-style local chat (`POST {base}/api/chat`) | NDJSON lines, `done: true` with `prompt_eval_count`/`eval_count`, complete-object tool calls with SYNTHESIZED deterministic call ids (`<name>#<ordinal>`) | `GET {base}/api/tags` | none (local daemon) |

Every adapter: request/response mapping as exported PURE functions, typed error
mapping (401 AUTH_FAILED / 404 NOT_FOUND / 429 RATE_LIMITED with Retry-After /
5xx + 529 PROVIDER_OVERLOADED / 400 with context-length wording CONTEXT_OVERFLOW /
malformed frames MALFORMED_RESPONSE / aborts CANCELLED vs TIMEOUT), token
accounting with the deterministic estimate AND the provider-reported numbers
side by side, and provenance on every finish (provider id, model id, sha256
request hash, adapter version, wire family).

`bridge.ts` maps the contract onto the native vscode surfaces (type-only
import): a `ProviderAdapter` becomes a `vscode.LanguageModelChatProvider`
(roles 1/2, untagged parts, tool-input accumulation into ONE
`LanguageModelToolCallPart` per call, quiet cancellation, errors carrying the
taxonomy code). The native API stays authoritative -- the bridge only
translates.

Remote vendors ship DISABLED with NO credentials (the zero-network default);
enabling one is an explicit act in `.flauz/models/providers.json` with a
credential REFERENCE (`env:<NAME>` / `vault:<NAME>`; literal keys are rejected
at validation). The Ollama-style local provider is enabled with an EMPTY model
catalog (local models exist only after the user lists them).

### Capability discovery + routing (src/discovery/, src/routing/)

- The durable registry (`.flauz/models/capabilities.json`,
  `flauz.model-capabilities/v0`) recovers from disk on restart; records carry
  provenance (`code-default` / `providers-file` / `discovered`). `query()` is
  the discovery seam for orchestration; `toAdapterConfigs()` is the activation
  seam. Corrupt state fails closed with typed errors (in-memory defaults +
  a visible degraded row, never silent reinterpretation).
- The declarative routing policy (`.flauz/models/routing-policy.json`,
  `flauz.model-routing-policy/v0`) is prioritized rules: capability
  requirements -> ranking (prefer-order / cost / context-fit / locality).
  Every route is a persisted `RoutingDecision`
  (`.flauz/models/routing-decisions.jsonl`, append-only, `rd-NNNNNN` ids
  unique across restarts) recording which rule fired, every candidate
  considered, every exclusion reason and the selection basis. NO SILENT
  FALLBACKS: the shipped default rule routes to `flauz-mock` and is
  EXPLICITLY LABELED as the zero-network default.

### Model-aware context budgets (src/budget/)

`ContextBudget` (input/output/tool reserves per model window; policy
overridable; typed OVERRUN failures instead of silent clamps) and the budget
compiler `compileFittingPlan` (deterministic truncation priority: oldest
non-pinned tool results -> attachments -> tail-keep truncation -> conversation
drops; system/pinned/last-turn protected; overflow reported honestly for
re-routing). This is the SHARED SEAM for Worker C's context compilation.

### MCP/tool posture (src/mcp/, MCP-POSTURE.md)

POLICY RECORDS ONLY: which agents may use which tools / MCP servers
(`.flauz/models/tool-policy.json`, `flauz.tool-policy/v0`, fail closed).
The native `lm.registerTool` / `lm.tools` / `lm.invokeTool` and the contrib/mcp
subsystem stay authoritative -- see MCP-POSTURE.md for the full mapping.

## Activation

Lazy on purpose: `onView:flauz.models` + `onLanguageModelChatProvider:<vendor>`
(mock + three adapter vendors) + the two view commands. Activation registers
the mock provider and the three adapter-backed vendors SYNCHRONOUSLY; model
lists arrive when the (async) registry load completes. A disabled vendor
reports ZERO models -- nothing appears in the picker until the workspace
providers file enables it. No workspace root = in-memory registry (documented
degraded posture; no durable files are written).

## Layout

```
package.json            contributes.languageModelChatProviders (flauz-mock + 3 adapter vendors)
tsconfig.json           strict, NodeNext, noEmit, allowImportingTsExtensions
shims/node.d.ts         hand-written ambient Node typings (zero @types/node)
vscode-dts/             vendored vscode declarations (PROVENANCE below)
MCP-POSTURE.md          the MCP/tool integration posture (M5)
src/extension.ts        activate(): mock + fabric bootstrap + view
src/fabric.ts           the activation seam (registry + policies + adapter vendors)
src/mockProvider.ts     deterministic echo provider + buildEchoResponse()
src/contract/           the vendor-neutral adapter contract (M1)
src/adapters/           three real adapters + the vscode bridge (M2)
src/discovery/          provider configs + durable capability registry (M3)
src/routing/            declarative policy + decision ledger (M3)
src/budget/             context budgets + the fitting-plan compiler (M4)
src/mcp/                the agent tool policy seam (M5)
src/vendors/            VendorPlan types + codex/claude/qwen design stubs (Lane F, unchanged)
test/harness/           vscode-mock (fidelity doubles) + module redirect
test/fixtureServer.ts   zero-dep canned-route fixture server (loopback only)
test/fixtures/          canned vendor wire payloads (happy + error + malformed)
test/*.test.ts          node:test suites (contract, adapters, bridge, registry, routing, budget, mcp, views, extension)
```

## Toolchain constraints

Node >= 23.6 runs the `.ts` sources directly via type stripping: ESM-only and
limited to ERASABLE TypeScript syntax (no enums, no namespaces, no parameter
properties; relative imports use explicit `.ts` extensions; `import type` for
type-only imports). Enum-backed API values
(`LanguageModelChatMessageRole.User === 1`) are pinned as documented number
constants.

Runtime tests of `src/extension.ts` (which value-imports `vscode`) use
`node:module` `registerHooks` to redirect the `vscode` specifier to
`test/harness/vscode-mock-module.ts`.

## Running the checks

No install, no build (the Code OSS repo is NEVER built in-sandbox). TypeScript
is a declared devDependency only; use the workspace binary:

```
/home/z/my-project/node_modules/.bin/tsc --noEmit -p extensions/flauz-models/tsconfig.json

node --test extensions/flauz-models/test/*.test.ts
```

Expected: tsc exit 0; 104 tests, 104 pass, 0 fail.

## Vendored vscode declarations (PROVENANCE)

- `vscode-dts/vscode.d.ts` -- copied verbatim from
  `src/vscode-dts/vscode.d.ts` @ `9bf9ae764da438b1234a8243dc9e47173ef58ee7`
  (payswapdotorg/Flauz pristine mirror of microsoft/vscode). Only a
  PROVENANCE line was prepended. Do not edit.
- `vscode-dts/vscode.proposed.languageModelPricing.d.ts` -- same provenance
  from `src/vscode-dts/vscode.proposed.languageModelPricing.d.ts`.

## Packaging (CI-side)

`package.json` points `main` at `./dist/extension.js`, which does not exist
in-repo (`dist/` is gitignored). Producing the esbuild ESM bundle for the
flauz built-in collection is CI-side work, same as the other Flauz built-in
extensions.
