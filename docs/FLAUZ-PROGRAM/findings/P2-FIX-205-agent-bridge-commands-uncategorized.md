# P2-FIX-205 — The ledger-verify and tasks-file palette commands sit outside the Flauz family (and one masquerades as the Tasks view)

Finding domain: TL4 (product IA/UX) · Found by: P2-003 (Worker B discovery audit, row DA18) · Status: READY-TO-CLAIM

## Observable user behavior

A returning user finishes a task, signs off, and wants to do the last
journey stage — inspect provenance — by verifying the evidence ledger.
They open the command palette and type "flauz":

- The Flauz commands group under the **Flauz** category — but
  **"Verify Flauz Evidence Ledger"** and **"Show Flauz Tasks"** do not
  carry the category, so they sort *outside* the family (into the
  uncategorized tail of the palette). A user scanning the Flauz group
  will not see the product's integrity affordance; a user typing
  "verify" finds an orphan entry with no Flauz grouping.
- **"Show Flauz Tasks"** is one word away from the view-focus command
  **"Focus Flauz Tasks"** — but it does something categorically
  different: it dumps the raw `.flauz/tasks.json` file into an editor.
  A user who wanted the Tasks *view* gets a JSON file; the surprise is
  cheap but real, and the near-collision makes it likely.
- **"Verify Flauz Evidence Ledger"** runs the verification and writes
  the verdict (`ok`, `rows`, `firstBadSeq`) only to the output-channel
  log — the returning user is shown a log line, not a verdict. The
  affordance exists but its result surface is a developer channel.

## Evidence + runtime level

`local-real` (static contract over the real product sources at pinned base
`7558680d8c537cc724c5026ca4a637afc86a1d72`):

- `extensions/flauz-agent/package.json` — `contributes.commands`:
  `flauz.showTasks` ("Show Flauz Tasks") and `flauz.verifyLedger`
  ("Verify Flauz Evidence Ledger") have **no `category`**; the sibling
  commands (`flauz.focusView.agentSessions`, `flauz.agent.refreshSessions`)
  carry `category: "Flauz"` — the family pattern exists and these two sit
  outside it.
- `extensions/flauz-agent/src/extension.ts` — `flauz.showTasks`
  implementation: `openTextDocument` on `.flauz/tasks.json` +
  `showTextDocument` (the raw file); `flauz.verifyLedger` implementation:
  `seam.verifyLedger()` → `log(...)` → `channel.show()` (output channel
  only).
- Contrast: `flauz.focusView.tasks` ("Focus Flauz Tasks", category
  "Flauz", in flauz-workspace) — the title collision is with this
  command.
- Machine check: `build/flauz/discovery/p2-003-discovery-gate.mjs` row
  DA18 — fires twice (`DA18:flauz.verifyLedger`,
  `DA18:flauz.showTasks`): both need `category` exactly `"Flauz"` and a
  non-empty title that does not collide with the view-focus commands
  (`--strict` fails on both today).

## Owning domain

TL4 (product IA/UX — palette categorization and command title semantics in
a TL4-001-family surface).

## Proposed contract change

In `extensions/flauz-agent/package.json` `contributes.commands`:

1. `flauz.verifyLedger`: add `"category": "Flauz"`; keep the title.
2. `flauz.showTasks`: add `"category": "Flauz"` and retitle to state what
   it does, e.g. `"Show Flauz Tasks File (raw JSON)"` — no longer one
   word away from "Focus Flauz Tasks".
3. (Advisory, same fix window, same file): surface the verify verdict to
   the user — a `window.showInformationMessage`/`showWarningMessage`
   verdict (`Ledger verified: N rows OK` / `Ledger FAILED at seq S`) in
   addition to (not instead of) the log line, so "inspect provenance"
   does not end in a developer channel.

## Exact owning TL

TL4 (manifest keys + one presentation line in flauz-agent's extension
source; the seam call `seam.verifyLedger()` — TL2's contract — is already
correct and untouched).

## Acceptance test

1. `node build/flauz/discovery/p2-003-discovery-gate.mjs --root . --require --strict`
   exits 0 for row DA18 (both `DA18:flauz.verifyLedger` and
   `DA18:flauz.showTasks` pins retire).
2. Runtime re-verification (TL4 station): in the palette, both commands
   appear inside the Flauz category; running "Verify Flauz Evidence
   Ledger" shows the verdict to the user (message surface), not only the
   output channel; "Show Flauz Tasks File (raw JSON)" no longer
   title-collides with "Focus Flauz Tasks".
3. `sh build/flauz/scripts/verify-fixtures.sh` stays ALL-CASES-AS-EXPECTED
   (the clean fixture encodes both commands categorized).

## Architecture-change requirement

No. Two manifest keys, one title string, and (advisory) one message call
after an existing seam invocation.
