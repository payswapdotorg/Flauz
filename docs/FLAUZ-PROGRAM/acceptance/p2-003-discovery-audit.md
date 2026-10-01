# P2-003 — User Discovery Audit Record (TL4 / Product Acceptance)

## Header

| Field | Value |
|---|---|
| Work order | P2-003 — User discovery audit (Worker B) |
| Pinned base | `7558680d8c537cc724c5026ca4a637afc86a1d72` (origin/main HEAD at dispatch) |
| Branch | `p2/b-discovery-audit` (local; identity `P2 Worker B <p2-worker-b@flauz.local>`) |
| Date | 2026-09-29/30 (Africa/Accra) |
| Audit surface | The six TL4-001 views (Home, Tasks, Agent Sessions, Environments, Browser, Models) + the `flauz.agent` chat participant + the shipped guide (`flauz-guide.md`) + the `flauz.*` command palette family, at the pinned base |
| Evidence levels used | `local-real` only — static contract over the real view sources, extension manifests, participant contributes and shipped guide (the ia-gate/premium-ux-gate precedent's own evidence class). **No `runtime-real` row is claimed** (see the feasibility probe below). Fixture evidence is used ONLY to prove the gate's rules fire — never as a UX verdict. |
| Verdict | **23 rubric rows: 18 PASS · 5 NON-PASS (all routed `P2-FIX-201..205`) · 0 NON-AUDITED.** The discovery spine is sound; the defects are two capability-visibility silences (delegation/A2A, takeover) and three affordance-polish gaps (welcome link, inert Home row, palette categorization). |
| Machine check | `node build/flauz/discovery/p2-003-discovery-gate.mjs --root . --require` → exit 0, `18 PASS · 6 KNOWN-GAP (routed: P2-FIX-201..205) · 0 unknown misses — 23 rubric rows` |

## Evidence-law compliance (PRODUCT-PHASE.md)

- Every PASS row below cites real files/lines in the pinned tree (the gate's evidence output, reproducible with the command above).
- Every NON-PASS row is routed to a finding in the `P2-FIX-2xx` range (Worker B owns 201..299) with the full seven-field format under `docs/FLAUZ-PROGRAM/findings/`.
- No rubric row is marked NON-AUDITED: every row is statically inspectable in the tree, and the two capability-word rows (DA11/DA16) are decidable by exhaustive corpus scan (the gate does exactly that).
- Fixture runs prove rule behavior, not product quality: the `clean` fixture encodes the TARGET contracts (post-fix ideal), the four drifted fixtures prove the rules fire.

## Runtime-real feasibility probe (honest residue)

The audit would have preferred to boot the actual product workbench (the
compat-l3 lane is the established boot drill). Probe receipts at audit time
(2026-09-29, this sandbox):

| Fact | Value |
|---|---|
| node | v24.21.0 (repo `.nvmrc` pins 24.18.0 — same major) |
| cores | 2 |
| RAM | 4159 MB total / ~2998 MB available |
| free disk | 6.3 GB |
| `node_modules/`, `out/` | absent (fresh clone) |
| CI comparison | compat-l3 budgets **90 minutes** on a 4-core/16GB ubuntu runner: `npm install` + the full hygiene compile pipeline + dev compile + xvfb boot |

Install + full compile + boot is infeasible here (the install alone
resolves ~1583 packages; disk headroom is 6.3 GB against a much larger
compiled tree). All rows are therefore `local-real` static-contract
verdicts; **runtime re-verification at the TL4 station is the recorded
residual** (each finding's acceptance test names it).

## Method

1. Read the pinned tree's six view sources, five extension manifests'
   `contributes` (views, viewsWelcome, commands, chatParticipants,
   languageModelTools, menus), the participant implementation and the
   shipped guide.
2. Walked both personas over the real surfaces (narratives below): the
   new user on the empty-product state (welcomes, empty states), the
   returning user on populated-state rows, recovery paths, provenance
   and the palette.
3. Encoded every row as a machine check in the discovery gate
   (`build/flauz/discovery/`, zero-dep) so the audit is reproducible: 23
   rows, fail-closed (an unlocatable surface is a MISS, never a silent
   pass), the 5 NON-PASS verdicts pinned as known gaps routed to findings
   (`--strict` flips them to failures after the fixes land).

## Rubric (the TL4-PRODUCT-HANDOFF P2-003 checklist, 9 areas × persona split)

Verdicts are the gate's real output on the pinned tree. Evidence pointer =
the gate's cited file(s); full detail in the gate output.

| Row | Area | Persona | Contract | Verdict | Evidence (level `local-real`) | Notes |
|---|---|---|---|---|---|---|
| DA01 | A1 view-discoverability | new | six views in the single `flauz` container, human names | **PASS** | 6 manifests: `flauz.home`→Home … `flauz.models`→Models, container `flauz` | — |
| DA02 | A1 view-discoverability | new | focus-command family, category "Flauz" (palette/F1) | **PASS** | `flauz.focusView` + 5 per-view focus commands, all category "Flauz" | — |
| DA03 | A2 next-steps | new | every welcome links its surface's primary next action | **NON-PASS → P2-FIX-201** | `flauz.environments` welcome links Refresh + Back to Home only; `flauz.env.register` exists (category Flauz) but is unlinked | Home/Tasks/AgentSessions/Browser link their primaries; Models is the recorded honest no-action posture (no creation command in v0) |
| DA04 | A2 next-steps | new | every welcome explains the surface (guidance sentence) | **PASS** | 6/6 welcomes carry a ≥30-char sentence ending `.!?` | — |
| DA05 | A2 next-steps | new | Home: Open Folder link + no-folder view links | **PASS** | Home welcome: Open Folder + "No folder yet? … View Tasks · View Environments" | — |
| DA06 | A2 next-steps | returning | every Home "not initialized" row carries an action | **NON-PASS → P2-FIX-202** | `workflowsRow()` `!state.present` branch: no `command` — the only inert Home row | Environments not-initialized branch carries `flauz.focusView.environments` (the contrast) |
| DA07 | A3 capability-discoverability | new | agent capability discoverable | **PASS** | `flauz.agent` contributed as DEFAULT participant; description "Plan-driven agent bridge with human approval gates and an append-only evidence ledger."; Tasks/AgentSessions welcomes point to Chat | — |
| DA08 | A3 capability-discoverability | new | browser capability discoverable | **PASS** | Browser welcome links `flauz.browser.setPolicy`; 11 `flauz.browser.*` commands | — |
| DA09 | A3 capability-discoverability | new | environments capability discoverable | **PASS** | Welcome explains `.flauz/environments.json` (trust/capabilities/plans); `flauz.env.register` + 18 `flauz.env.*` commands | The welcome LINK gap is row DA03/201; the capability itself is discoverable |
| DA10 | A3 capability-discoverability | new | models surface honest (registered vs stub) | **PASS** | flauz-mock named "deterministic, on demand"; stub rows labeled "design stub · not registered"; no-failure-source marker | — |
| DA11 | A3 capability-discoverability | new | delegation/A2A discoverable from some user-facing surface | **NON-PASS → P2-FIX-203** | Exhaustive corpus scan (welcomes, command titles/descriptions, participant + slash commands, tool userDescriptions, guide, view sources): zero matches for /delegat\|A2A\|agent-to-agent/i | The capability is real and proven (messaging.ts `A2A_MESSAGE_KINDS`, journey LEG 5) — it is *invisible*, not absent |
| DA12 | A4 error-recovery-grammar | new | shared error grammar on every failure-capable view | **PASS** | `flauzError` + Retry + retry sentence in 4 provider sources; models carries the documented no-failure marker | — |
| DA13 | A4 error-recovery-grammar | returning | recovery keeps last-known-good; Browser fails closed | **PASS** | Tasks/Environments keep LKG rows; Agent Sessions keeps live rows on probe failure; invalid policy → deny-all row (never stale); Home degraded rows "unreadable" | — |
| DA14 | A4 error-recovery-grammar | new | one time grammar (shared format.ts) | **PASS** | Single distinct `format.ts` implementation (5 verbatim copies across extensions — the sanctioned distribution pattern); every age-rendering view imports it | — |
| DA15 | A5 approval-takeover | new | approval gates comprehensible | **PASS** | 4 participant slash commands, every description names the human gate; followups Approve plan/Request changes/Sign off/Cancel task; terminal confirmation names the exact command | — |
| DA16 | A5 approval-takeover | new | takeover comprehensible from some user-facing surface | **NON-PASS → P2-FIX-204** | Corpus scan: zero matches for /takeover\|take over/i product-wide; the protocol carries `flauz.orch.requestTakeover`/`acceptTakeover` (actor human) and kill-recover holds `takeover-pending`/`taken-over` states — none of it user-visible | The missing half of the A5 pair: approvals visible, takeover invisible |
| DA17 | A6 evidence-provenance | new | evidence rows carry provenance | **PASS** | id+kind+uri+age in description, SHA-256+UTC in tooltip, selecting opens the artifact | — |
| DA18 | A6 evidence-provenance | returning | ledger verify affordance palette-categorized | **NON-PASS → P2-FIX-205** (fires ×2) | `flauz.verifyLedger` + `flauz.showTasks`: no `category` (outside the Flauz palette family); `showTasks` also title-collides with "Focus Flauz Tasks" and dumps raw JSON; `verifyLedger` verdicts only to the output channel | 6 KNOWN-GAP instances map to 5 findings (DA18 hits both commands) |
| DA19 | A7 no-dead-ends | new | no dead-end empty states | **PASS** | 6/6 views: welcome + ≥1 action link | The DA03 gap is a *missing primary* action, not a dead end |
| DA20 | A7 no-dead-ends | returning | post-action states recoverable | **PASS** | verify-fail → approvable state with `/approve` retry instruction; execution failure appends fail event; failed/cancelled icons legible | — |
| DA21 | A8 accessibility | new | a11y labels on every tree row; error rows announce retry | **PASS** | `accessibilityInformation` on rows in all 5 provider sources; error-row a11y label announces the retry affordance | Static labels only — see residues for the runtime a11y boundary |
| DA22 | A8 accessibility | new | keyboard contract: focus + reveal + guide keys | **PASS** | Focus family + `flauz.workspace.revealTask`; Agent Sessions active-task row reveals the task (select+focus+expand); guide documents tree keys | — |
| DA23 | A9 web-posture | new | tree views only + parity registry covers every flauz extension | **PASS** | No webview contributions; parity registry classifies all 9 flauz extensions | — |

## First-run walkthrough (new user, empty product)

A user opens the product cold. The activity bar shows the **Flauz** icon;
clicking it reveals six views named Home, Tasks, Agent Sessions,
Environments, Browser, Models — plain words, no jargon (DA01). F1 or the
palette offers "Focus Flauz View" and one focus command per view, grouped
under **Flauz** (DA02).

**Home** greets them: *"Flauz turns your workspace into an
agent-centric environment: tasks with human gates, hash-chained evidence,
environments, browser policy and workflows — all in .flauz/."* with an
**Open Folder** link, and — the detail that saves the no-folder first run —
*"No folder yet? Learn what Flauz tracks: View Tasks · View
Environments"* (DA05). They open a folder.

**Tasks** is empty: *"Ask the Flauz agent in Chat to plan your first
task — every task lives in .flauz/tasks.json with its evidence trail
attached here."* with an **Open Chat** link (DA03-pass, DA07). The
participant is already pinned as the default chat participant: *"Plan-driven
agent bridge with human approval gates and an append-only evidence
ledger."* They type a mission; the agent plans and answers with explicit
followups — *"Reply `/approve` to start execution, `/request-changes` to
re-plan, or `/cancel` to abort"* — and every slash command's description
names the human gate (DA15). When the agent wants the terminal, the
confirmation names the exact command (DA15).

**Environments** is empty and honest about what the registry is — but its
links are **Refresh** (a no-op on an empty registry) and **Back to Flauz
Home**. The action the user actually needs, **Register Environment**, is
absent (DA03-miss → **P2-FIX-201**). It exists in the palette and the
guide's "Where to go next" (`Flauz: Register Environment`) — but only if
they think to look there.

**Browser** is empty and does it right: the welcome explains fail-closed
deny-by-default and links **Open (or Create) Browser Policy File**
(DA08). **Models** is empty and honest — the deterministic flauz-mock
provider, design stubs labeled as design stubs (DA10). Nothing asks the
user to trust something they cannot see.

What the user **never** learns, from any surface: that an agent can
**delegate** steps to other agents (DA11-miss → **P2-FIX-203**). The
multi-agent capability is shipped and proven — it is simply invisible.

If something breaks on first contact — an unreadable `.flauz/tasks.json`,
say — the view does not go blank: an **Unable to Load …** row appears,
selecting it retries, and the row's context menu opens the guide (DA12).
The guide's "States and recovery" section explains exactly what the user
is looking at.

## Returning-user walkthrough

The user reopens a populated workspace. **Home** shows live state per row
— environments registered with the active id, browser policy "workspace
file", tasks counted — and every row is a navigation affordance *except
one*: **Workflows — not initialized**, the row whose click does nothing
while its tooltip explains why it's empty (DA06-miss → **P2-FIX-202**).
The irony is visible in the same view: the Environments "not initialized"
row, in the identical posture, does carry its focus command.

**Agent Sessions** shows the bridge status — core service, participant,
terminal tool, models, the active task — and the active-task row reveals
that task in **Tasks** with its evidence expanded (DA22). A task that
failed renders the error icon with the error text; a task whose verify
step failed returns to an approvable state with an explicit `/approve`
retry instruction (DA20). A failed refresh keeps the last-known-good rows
below the error row; an invalid browser policy falls back to the built-in
deny-all — never a stale policy (DA13). Timestamps read consistently
everywhere because they all come from the one shared `format.ts` (DA14).

**Evidence**: expanding a task shows its evidence trail — id, kind, uri,
age in the row; SHA-256 and UTC timestamps in the tooltip; selecting
opens the artifact (DA17). This is the strongest stretch of the product:
provenance is a first-class reading experience.

Then the returning user does the journey's last stage — *inspect
provenance* — and the polish gaps surface. In the palette, **Verify Flauz
Evidence Ledger** and **Show Flauz Tasks** sort *outside* the Flauz
family: no category (DA18-miss → **P2-FIX-205**). Verifying writes the
verdict to the output-channel log — a developer surface. And "Show Flauz
Tasks" — one word from "Focus Flauz Tasks" — dumps the raw
`.flauz/tasks.json` into an editor instead of focusing the view.

The deepest gap needs a stuck step to find. The architecture's answer to
a stuck step is **human takeover** — journaled, human-gated, proven in the
rehearsal. In the product it does not exist as far as the user can tell:
four slash commands steer the agent; none takes work over (DA16-miss →
**P2-FIX-204**). The user's only visible option against a stuck task is
cancel-and-replan — a capability the product has, silently missing its
surface.

## Summary verdict

- **23 rows audited, 0 non-audited** — every row statically decidable and
  machine-checked.
- **18 PASS**: the discovery spine — views, welcomes, error/recovery
  grammar, provenance, a11y labels, keyboard contract, web posture — is
  sound and consistent across all six views.
- **5 NON-PASS, all routed**:
  - `P2-FIX-201` (TL4) — Environments welcome misses its primary action.
  - `P2-FIX-202` (TL4) — the one inert Home row.
  - `P2-FIX-203` (TL2) — delegation/A2A invisible.
  - `P2-FIX-204` (TL2) — takeover invisible.
  - `P2-FIX-205` (TL4) — palette family + title collision + verdict surface.
- Severity pattern: no dead ends, no broken flows — **two capability
  silences** (203/204, TL2 semantics with user-facing verbs undefined) and
  **three affordance-polish defects** (201/202/205, TL4 surface text).

## The audit harness (deliverable A + D)

- `build/flauz/discovery/p2-003-discovery-gate.mjs` — CLI (`--root`,
  `--require`, `--strict`), zero-dep (node ≥ 20 stdlib), fail-closed.
- `build/flauz/discovery/rubric.mjs` — the 23-row rubric + the pinned
  `KNOWN_GAPS` registry (the honest-CI mechanism: pinned misses stay
  routed, unpinned misses always fail, `--strict` enforces post-fix).
- `build/flauz/discovery/audit.mjs` — surface loader + the 23 checks.
- `test/fixtures/discovery-gate/{clean,fail-missing-view,fail-welcome-link,fail-error-grammar,fail-a11y}/`
  — the clean tree encodes the TARGET contracts (post-fix ideal, the
  findings' acceptance shape); four drifts prove the rules fire.
- Wired: 11 cases in `build/flauz/scripts/verify-fixtures.sh`; CI step in
  `.github/workflows/flauz-hygiene.yml` (after premium-ux-gate, same lane
  pattern); the 3 `.mjs` files in `.eslint-allowed-javascript-files`;
  gate row in `build/flauz/README.md` section 2.
- **No extension source, no `src/vs`, no control-plane doc was touched**
  (the audit is additive; the registry text below is *proposed*, for the
  lead to land).

## Honest residues

1. **No runtime-real row.** Every verdict is `local-real` (static
   contract). The workbench boot drill is infeasible in this sandbox
   (probe receipts above). Each finding's acceptance test names the
   runtime re-verification the TL4 station should run.
2. **A11y is labels-only.** DA21/DA22 verify `accessibilityInformation`
   presence, error-row announcements and the keyboard contract at the
   source level — NOT screen-reader behavior, focus order, contrast or
   actual key handling (no a11y runtime tooling here).
3. **Personas are analytical.** The walkthroughs trace real surfaces and
   real user paths, but no live user session was run (implied by residue
   1).
4. **Scope edges not audited:** palette *search ranking*, keybinding
   collisions with upstream defaults, the Settings/UI surface, and the
   desktop-vs-web deltas beyond the parity registry's classification.
5. **DA14 note:** the shared `format.ts` exists as 5 sanctioned verbatim
   copies (the distribution pattern the premium-ux gate enforces) —
   consistent, but a future single-source opportunity, not a finding.

## Proposed registry text (for WORK-REGISTRY.md — the lead lands this)

> ### P2-003 — User discovery audit
> Status: DONE (Worker B delivery on `p2/b-discovery-audit`, local commit off `7558680`; harvested in-window)
> Purpose: test whether the architecture's capabilities are discoverable, understandable and recoverable through the actual product UX.
> Landing record: 23-row rubric (TL4-PRODUCT-HANDOFF checklist × persona split) audited at `local-real` (static contract over the six views, participant, guide and palette family; runtime boot infeasible in the delivery sandbox — receipts in the audit record). Verdict: 18 PASS · 5 NON-PASS routed `P2-FIX-201..205` (201 environments-welcome-primary-action, 202 home-workflows-row-inert, 203 delegation-a2a-undiscoverable, 204 takeover-not-comprehensible, 205 agent-bridge-commands-uncategorized) · 0 non-audited. Harness: `build/flauz/discovery/` (zero-dep gate, fail-closed, pinned KNOWN_GAPS routed to findings, `--strict` post-fix mode), 11 fixture cases in verify-fixtures.sh, CI step in flauz-hygiene.yml. Findings awaiting claim per domain (201/202/205 → TL4; 203/204 → TL2). Residual: runtime re-verification at the TL4 station (each finding's acceptance test names it).
