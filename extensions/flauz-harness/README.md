# Flauz Harness

The Domain Harness console (DH-010): drive the onboarding selection
session (industry, company, work types, roles) through the real
Domain Harness OS kits, inspect any harness's projected navigation
model (overview, roles, workflows, capabilities, policies, evidence,
KPIs, benchmarks, lifecycle), and record proposed drafts.

## What the console shows

- **Selection session** - the observed DH-02 onboarding session: the
  driven session row (its REAL stage), the observed industry /
  company / work-types / roles / proposed-harness fields (honest
  "(not ... yet)" markers until the session sets them), and the
  workspace's composed DH-03 role-composition sessions (the draft's
  composition menu; click one to select it).
- **Harnesses** - the workspace's DH-01 harness records observed from
  the real harness ledger (state + industry + display name); click one
  to inspect its navigation model.
- **Navigation model** - the inspected harness's DH-010 projection:
  the nine frozen sections with their derived rows and badges
  (`overview, roles, workflows, capabilities, policies, evidence,
  kpis, benchmarks, lifecycle`). A family with no composed content
  yet renders the honest "not composed" section with ZERO rows -
  never fabricated.
- **Lifecycle** - the anchor's REAL lifecycle state with the closed
  activation door disclosed on the row.
- **Recorded proposals** - the proposed-draft state (reversible,
  in-session) with the activation refusal riding verbatim on every
  record.

## The closed seams (by design)

- **Composition routes through the real kits.** Begin session /
  select industry / compose company / select work types / propose
  draft are the REAL DH-02 onboarding ops; the draft's review
  composition is emitted by the REAL DH-03 kit
  (`emitReviewComposition`, refs default EMPTY - the honest gap law;
  wiring the ref families is the DH-004/DH-005/DH-008/DH-011 lanes');
  the harness is minted by the inner REAL DH-01 kit. The console
  mints nothing and validates nothing of its own.
- **NOTHING executes.** The console selects, inspects and composes
  configuration; no agent work, no tool, no execution is triggered
  from this surface.
- **Activation stays routed through the DH-01 authority.** The
  console never advances a lifecycle state (draft -> proposed ->
  approved -> active -> retired). The refusal rides the lifecycle row
  and EVERY recorded proposal, verbatim: "Activation routes through
  the DH-01 harness authority (advanceHarness): the Harness console
  never becomes a second lifecycle authority."
- **The catalog seam (disclosed):** the DH-01 catalog snapshot this
  surface injects is the EMPTY resolution surface - the draft
  composes with empty ref families (the DH-03 emit's honest gap).
  Wiring the real capability registry into the catalog is the DH-011
  end-to-end lane's step, never this surface's fork of it.

## Architecture

- `src/harnessState.ts` - the pure console state machine
  (vscode-free, node-free; fully covered by `node --test`).
- `src/harnessPort.ts` - the injected port contract (the onboarding
  ops, the harness-list/navigation-load surfaces; the state machine
  and tests depend ONLY on this contract).
- `src/harnessView.ts` - the `flauz.harness` tree view (vscode slices
  injected; container `flauz` is owned by flauz-workspace).
- `src/flauzHarnessPort.ts` - the runtime binding to the real Domain
  Harness OS kits at `build/flauz/harness/` (the only cross-lane
  runtime edge; esbuild resolves the kits' `.js` specifiers at bundle
  time; no node-test file imports it - but the binding drill
  `test/flauzHarnessPort.binding.drill.ts` executes it under bun, the
  runner that resolves those `.js` specifiers natively).
- `src/extension.ts` - activation wiring (view registered FIRST,
  narrow `onView:flauz.harness` + `onCommand:flauz.harness.*`
  activation only - the activation budget law).
- `src/format.ts` - the shared timestamp formatting (the PU6 verbatim
  copy of the flauz-lab format module; the single timestamp source).

The typed projection family lives at
`build/flauz/harness/projections/` (the DH-010 derivation layer,
station-gated by the mocha/tdd lane); this extension only consumes it
through the runtime binding.

## Run commands + receipt table

```sh
# from extensions/flauz-harness (or the repo root with full paths)
node --test test/*.test.ts                # 66 pass, 0 fail (32 state + 34 view)
~/toolchain/node_modules/.bin/tsc -p tsconfig.json --noEmit   # EXIT 0

# from the repo root (the station's documented form)
bun extensions/flauz-harness/test/flauzHarnessPort.binding.drill.ts   # exit 0
```

| Gate | Command | Receipt (this delivery) |
| --- | --- | --- |
| Extension typecheck | `tsc -p extensions/flauz-harness/tsconfig.json --noEmit` | EXIT 0 |
| Extension test lane | `node --test extensions/flauz-harness/test/*.test.ts` | 66 pass, 0 fail |
| Runtime binding drill | `bun extensions/flauz-harness/test/flauzHarnessPort.binding.drill.ts` | exit 0 — the full op chain over the real kits (the DH-02 session walk, the DH-03 compose+emit at the same root, the propose boundary minting the harness through the inner real DH-01 kit, the real DH-010 nine-section projection, the determinism double-run), the closed activation door pinned on the port surface |
| Projection family battery | `bunx --bun mocha --ui tdd build/flauz/harness/projections/test/common/*.test.ts` | 153 pass, 0 fail |

The runtime binding drill (the DH-GAP-5 wave, the INF-009 canary's
`real-execution drill` precedent): the `.drill.ts` suffix keeps it
OUTSIDE the node `--test` glob — the node lane still never imports
`src/flauzHarnessPort.ts` (Node type stripping cannot resolve the
kits' `.js` specifiers, the flauz-lab law's letter kept) — while bun
resolves the `.js`-specifier-to-`.ts` imports natively (the same
runner law the `build/flauz` family batteries document). It drives
the port end-to-end over the REAL kits with the fixed injected
clock/rng seams (deterministic ids, pinned harness id), needs no env
and no network, and removes its temp roots on exit.
