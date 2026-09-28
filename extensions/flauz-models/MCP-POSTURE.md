# flauz-models -- MCP / tool integration posture (TL2-002, M5)

## Rule

The NATIVE subsystems are authoritative. Flauz adds POLICY, not gates.

## The native surfaces this fabric is mapped onto

| Native surface | Where | Role |
|---|---|---|
| `vscode.lm.registerTool` (stable, vscode.d.ts:20778) | flauz-agent's `flauz_terminal` (terminalTool.ts) | Flauz-native tools are ordinary registered language-model tools with native `prepareInvocation` confirmation (the human-authorization gate) |
| `vscode.lm.tools` / `vscode.lm.invokeTool` (stable) | consumed by agent runtimes | discovery + invocation of every registered tool, native UX |
| `contributes.languageModelTools` | package.json of the owning extension | the declaration side that must stay in sync with `registerTool` |
| `contributes.mcpServerDefinitionProviders` + `vscode.lm.registerMcpServerDefinitionProvider` (vscode.d.ts:20820-20843) | NOT used by flauz-models (no MCP servers are contributed by this extension) | the seam a FUTURE Flauz MCP registry contribution would use |
| contrib/mcp gateway surfaces (`src/vs/workbench/contrib/mcp/browser/mcpGatewayService.ts`, `common/mcpLanguageModelToolContribution.ts`, `mcpRegistry.ts`, `mcpService.ts`) | upstream Code OSS, untouched | MCP servers surface their tools into `lm.tools` and may request language-model access through the gateway; Flauz does not wrap, re-gate or re-implement any of it |

## What flauz-models adds (the typed seam)

`src/mcp/policy.ts` -- a DURABLE POLICY RECORD (`.flauz/models/tool-policy.json`,
schema `flauz.tool-policy/v0`) that answers exactly one question:

> Which agents may use which tools and MCP servers when the Flauz agent
> runtime assembles its tool sets for a request?

- `evaluateToolPolicy(policy, agentId, toolName)` -> verdict (allowed,
  basis, matched pattern, explanation). FAIL CLOSED: unknown agents are
  denied; unmatched tools get the entry default (deny unless explicitly
  allowed).
- `evaluateMcpServerPolicy(policy, agentId, serverId)` -> same posture for
  MCP server ids.
- Patterns are exact tool ids or trailing-`*` prefixes; `*` alone allows
  all. Invalid patterns are rejected at load (typed `ToolPolicyError`).
- The shipped default grants the `flauz-agent` bridge the two Flauz-native
  tool families (`flauz_terminal`, `flauz_browser_*`), NO MCP servers, and
  default-deny for everything else.

## What this deliberately does NOT do

- It does NOT re-gate the native UX: a human invoking a tool through the
  editor (chat UI, command palette, native MCP tool pickers) never passes
  through this policy. Only Flauz-driven AGENT tool-set assembly consults it.
- It does NOT wrap `lm.invokeTool`, proxy `lm.tools`, or intercept the
  contrib/mcp gateway. Worker A's orchestration consumes the verdicts when
  building the `tools:` list it passes into model requests.
- It does NOT carry credentials or secrets of any kind.

## Consumption contract (Worker A seam)

1. Load once per session (`loadToolPolicy`) -- the file materializes from
   the shipped default on first run and is then user-owned.
2. Before assembling a tool set for an agent turn: evaluate every candidate
   tool (`lm.tools` entries plus Flauz-native tools) and every MCP server
   the turn may consume; include only allowed ones.
3. Record the verdicts in the turn's provenance (the routing decision and
   the evidence ledger already carry explanations; tool-set assembly gets
   the same explainability).

## Why policy-only

The architecture lock (ARCHITECTURE-LOCK.md sections 3-4) places
authorization at authoritative control points and forbids duplicating
platform UX in extensions. The native confirmation/invocation flow IS the
authoritative control point for tool use; duplicating it inside Flauz would
create a second, divergent gate. A policy RECORD consumed at assembly time
adds the agent-scoping the platform does not provide, without touching the
platform's gate.
