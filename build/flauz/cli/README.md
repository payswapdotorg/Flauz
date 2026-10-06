---------------------------------------------------------------------------------------------
 Copyright (c) Flauz contributors. All rights reserved.
 Licensed under the MIT License. See LICENSE in the repository root for license information.
---------------------------------------------------------------------------------------------

# flauz -- the CLI/headless runtime (CR-010, wave 1)

A first-class headless CLIENT of Flauz over the ZC-009 parity
contracts (`build/flauz/zcode-patterns/cli/common/{grammar,wire,exitcodes,parity}.ts`).
The CLI is NEVER a second runtime: it holds no state models; every
read goes through the service-context port
(`build/flauz/cli/runtime/context.ts`) over the REAL seams
(`extensions/flauz-agent/core/orchStore.mjs`, `extensions/flauz-agent/core/a2a.mjs`).

## Invocation

	node --experimental-strip-types build/flauz/cli/bin/flauz.ts <args>

	USAGE: flauz <journey>.<command> [args...] [--json|--table|--digest]
	       flauz <journey> <command> [args...]   (equivalent two-token form)
	       flauz [--root <path>] [--issued-at <iso>] [--workspace-id <id>] [--tenant-id <id>]
	       flauz --help

## The headless law

The CLI never prompts, never waits. Interactive-only surfaces are
TYPED refusals carrying `headless-interactive-surface` and the exact
violated law from the frozen refusal table (wire.ts) -- disclosed,
never a prompt.

## The command census (29 commands, wave 1)

Wired (4) -- read-only projections over the real seams:

| path | seam |
|---|---|
| background-agent.roster | a2a list() (the roster view) |
| background-agent.inspect | a2 list() scoped to one agent |
| workflow.phases | orchStore getGraphState(id) |
| workflow.view | orchStore getGraphState(id) |

Typed refusals (25):

| code | paths |
|---|---|
| headless-interactive-surface (1) | approval.respond |
| parity-projection-missing (24) | workspace.status/list/focus; background-agent launch/message/pause/stop/cancel/resume; workflow.advance; approval.list; evidence.attach/list/verify; replay.plan/run/verify; lab.runs/catalog/calibration/recommendations; capability-discovery.sources/packs/search |

Owning CRs for the not-wired families: approval.* -> CR-002/003;
replay.* -> CR-004; capability-discovery.* -> CR-006/007/008. The
memory runtime (CR-005) has no grammar surface at contract v1.0.0.

Exit codes (exitcodes.ts, frozen): 0 ok, 1 typed-refusal, 2
usage-error (the parse layer: unknown command, flag problems, typed
parse mismatches, fail-closed process-edge diagnostics), 3 not-found
(an absent projection), 4 partial.

## Output shapes

`--json` (default): the canonical response record -- exactly the
fields renderSpec names, in contract order. `--table`: the
deterministic scan rows. `--digest`: one line -- the sha256 hex of
the canonical JSON of the response record. The `resultDigest` carried
by ok/partial responses is the sha256 of the canonical JSON of the
projected service state.

## Determinism

Every output byte is a function of (argv, the workspace files, the
injected issued-at). No Date.now, no Math.random anywhere in this
delivery: `--issued-at` injects the request timestamp (default: the
epoch constant) and durationMs is injected as 0 (echoed verbatim, as
the wire contract requires).

## Scope

workspaceId defaults to the resolved root's basename and tenantId to
`local`; `--workspace-id`/`--tenant-id` override. A mismatched
override is the typed `scope-isolation-violated` refusal (the
isolation law).

## Tests

	NODE_OPTIONS=--import tsx npx mocha --ui tdd build/flauz/cli/cli.test.ts