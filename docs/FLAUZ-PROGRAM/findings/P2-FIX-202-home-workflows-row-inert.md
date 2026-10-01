# P2-FIX-202 — The Home "Workflows: not initialized" row is inert (the only unactionable Home row)

Finding domain: TL4 (product IA/UX) · Found by: P2-003 (Worker B discovery audit, row DA06) · Status: READY-TO-CLAIM

## Observable user behavior

A returning user opens **Home** in a workspace where no run has been saved
as a workflow yet. The row renders:

> 🚀 Workflows — not initialized

with the tooltip:

> No .flauz/workflows/index.json yet — the index is created when a run is
> saved as a workflow.

Selecting the row does **nothing** — the row carries no `command`, so the
click is silently discarded. This is the only Home row that is inert:

- the sibling **Environments — not initialized** row carries
  `flauz.focusView.environments` ("Focus Flauz Environments"),
- the **Browser Policy** row carries `flauz.browser.setPolicy` in every
  branch,
- the **Tasks** and **Agent Sessions** rows carry reveal/focus commands,
- and the *populated* Workflows row itself carries `vscode.open` on the
  workflow index.

The tooltip is honest about the trigger, but it is not an affordance: a
user who wants to get from "not initialized" to their first saved workflow
has no in-product next step. The tooltip explains *when* the file appears,
not *what to do now* — and the only in-product explanation of saved
workflows (the guide's "Files Flauz creates" section) is one manual
`Flauz: Open Flauz Guide` away, undiscoverable from this row.

## Evidence + runtime level

`local-real` (static contract over the real product sources at pinned base
`7558680d8c537cc724c5026ca4a637afc86a1d72`):

- `extensions/flauz-workspace/src/views.ts` — `workflowsRow()`, the
  `!state.present` branch (row id `workflows`, description
  `not initialized`) returns a row with **no `command` field**; the
  populated branch carries `command: vscode.open` on
  `.flauz/workflows/index.json`.
- `extensions/flauz-workspace/src/views.ts` — `environmentsRow()`, the
  `!state.present` branch: same "not initialized" posture, but the row
  carries `command: flauz.focusView.environments` — the contrast that makes
  the workflows row the outlier, not the pattern.
- `extensions/flauz-workspace/flauz-guide.md` — "Files Flauz creates"
  documents `.flauz/workflows/` (saved workflow envelopes) and
  `flauz.workspace.openGuide` ("Open Flauz Guide", category "Flauz") exists
  as the natural link target.
- Machine check: `build/flauz/discovery/p2-003-discovery-gate.mjs` row DA06
  (pinned known gap `DA06:home-workflows-not-initialized`; `--strict` fails
  on it today).

## Owning domain

TL4 (product IA/UX — Home row affordance in the TL4-001 Home provider).

## Proposed contract change

Amend the Home contract (TL4-IA-SPEC / premium-UX Home section): every
Home row is actionable in every branch. For the workflows
`!state.present` branch, link the row to the guide — the only user-facing
surface that explains how a run becomes a saved workflow:

```ts
command: { command: 'flauz.workspace.openGuide', title: 'Open Flauz Guide' },
```

(Alternative considered and recorded for the owner: focus the Tasks view —
where the runs that can be saved live — but the guide is the honest target
while "save as workflow" has no user-facing verb in v0.)

## Exact owning TL

TL4 (the row lives in the flauz-workspace Home provider, a TL4-001 surface;
no TL1/TL2/TL3 contract is touched).

## Acceptance test

1. `node build/flauz/discovery/p2-003-discovery-gate.mjs --root . --require --strict`
   exits 0 for row DA06 (the `DA06:home-workflows-not-initialized` pin
   retires).
2. Runtime re-verification (TL4 station): in a workspace with no
   `.flauz/workflows/index.json`, selecting the "Workflows — not
   initialized" Home row opens the Flauz guide (no dead click).
3. `sh build/flauz/scripts/verify-fixtures.sh` stays ALL-CASES-AS-EXPECTED
   (the clean fixture already encodes the actionable row).

## Architecture-change requirement

No. One `command` field on a tree row in the Home provider source.
