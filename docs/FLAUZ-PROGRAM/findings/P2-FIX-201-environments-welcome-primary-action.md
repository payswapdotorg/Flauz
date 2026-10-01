# P2-FIX-201 — The Environments empty state does not link its primary creation affordance

Finding domain: TL4 (product IA/UX) · Found by: P2-003 (Worker B discovery audit, row DA03) · Status: READY-TO-CLAIM

## Observable user behavior

A new user with no environment registered opens the **Environments** view and
sees the empty state:

> No Flauz environments registered.
> Environments (local, SSH, container, cloud sandbox) live in .flauz/environments.json and carry trust, capabilities and connection plans.
> [Refresh Environments View] · [Back to Flauz Home]

The two offered actions are **Refresh Environments View** (a no-op on an
empty registry — there is nothing to re-read) and **Back to Flauz Home** (a
navigation hop away from the surface the user is trying to use). The action a
new user actually needs — **Register Environment** — is not offered. The
user must either know the command palette (`Flauz: Register Environment`) or
leave the view to read the guide's "Where to go next" section. The empty
state is therefore not a dead end (it has links and an explanation) but it
misses its own primary next action, the standard every other Flauz surface
meets (Tasks → Open Chat; Browser → policy file action; Home → Open Folder).

## Evidence + runtime level

`local-real` (static contract over the real product sources at pinned base
`7558680d8c537cc724c5026ca4a637afc86a1d72`):

- `extensions/flauz-environments/package.json` — `contributes.viewsWelcome`
  for `flauz.environments` links only `flauz.env.refreshView` and
  `flauz.focusView.home`.
- `extensions/flauz-environments/package.json` — `contributes.commands`
  includes `flauz.env.register` ("Register Environment", category "Flauz",
  palette-discoverable) — the affordance exists, it is just not linked from
  the empty state.
- `docs/FLAUZ-PROGRAM/TL4-PREMIUM-UX.md` section 9 records the current
  design decision ("welcome (Refresh primary — registration is
  command-driven)") — this finding does not dispute the record; it proposes
  amending the decision.
- Machine check: `build/flauz/discovery/p2-003-discovery-gate.mjs` row DA03
  (pinned known gap; `--strict` fails on it today).

## Owning domain

TL4 (product IA/UX — the empty-state content of a TL4-owned view).

## Proposed contract change

Amend TL4-PREMIUM-UX.md section 9 (`flauz.environments` row): the welcome's
primary link becomes **Register Environment** when the registry is empty
(keep Refresh + Back to Home as secondary links). Concretely, prepend one
line to the welcome contents:

```
[Register Environment](command:flauz.env.register)
```

## Exact owning TL

TL4 (the welcome string lives in the flauz-environments manifest, a TL4-001
surface; no TL1/TL2/TL3 contract is touched).

## Acceptance test

1. `node build/flauz/discovery/p2-003-discovery-gate.mjs --root . --require --strict`
   exits 0 for row DA03 (the `DA03:flauz.environments` pin retires).
2. Runtime re-verification (TL4 station): with an empty registry and a
   workspace open, the Environments view's welcome shows a clickable
   "Register Environment" link that opens the register flow.
3. `sh build/flauz/scripts/verify-fixtures.sh` stays ALL-CASES-AS-EXPECTED
   (the clean fixture already encodes the post-fix welcome).

## Architecture-change requirement

No. A viewsWelcome contents string in an extension manifest; no core, seam
or service surface is involved.
