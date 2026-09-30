# P2-FIX-204 — Takeover is invisible: the human's stuck-step escape hatch has no user-facing affordance

Finding domain: TL2 (Agent OS / orchestration) · Found by: P2-003 (Worker B discovery audit, row DA16) · Status: READY-TO-CLAIM

## Observable user behavior

A task step is stuck (the agent is blocked, the gate is pending, work has
halted). The architecture's answer is **human takeover**: the human can
interrupt the pending gate and take the step over by hand — the kill-recover
matrix guarantees a kill at any lifecycle point leaves a *human-gated*
state (`takeover-pending` / `taken-over` NEVER auto-advance; human-only
transitions), and the journey rehearsal's LEG 6 proved the full fail-closed
sequence with the step "completed by the HUMAN, never by an unapproved
agent execution", takeover evidence minted into the shared chain.

In the product, this capability does not exist as far as a user can tell:

- The word "takeover" appears **nowhere** a user can see — no welcome, no
  command title or description, no participant text, no tool description,
  not the guide, not any view source.
- The chat participant exposes exactly four human gates — `/approve`,
  `/request-changes`, `/sign-off`, `/cancel` — none of which is takeover
  (they steer the agent; takeover *replaces* the agent on a step).
- The Agent Sessions view renders live/failed/cancelled sessions but has
  no takeover affordance or state.
- The program journey itself lists "human approval/takeover" as a stage a
  user must be able to require and handle.

The result is an asymmetry inside the same checklist area: **approvals are
comprehensible (DA15 PASS — four labeled human gates, followups, named
terminal confirmation), takeover is not (DA16)**. A user with a stuck step
has no in-product way to discover that taking it over by hand is possible,
safe, and evidence-bearing — the single most important escape hatch of the
delegation/approval model.

## Evidence + runtime level

`local-real` (static contract over the real product sources at pinned base
`7558680d8c537cc724c5026ca4a637afc86a1d72`):

- `extensions/flauz-agent/test/orchProtocol.conformance.test.ts` — the
  orchestration protocol carries `flauz.orch.requestTakeover` /
  `flauz.orch.acceptTakeover` (actor `human`) — the capability is in the
  protocol, agent-side.
- `extensions/flauz-agent/test/orchestration.killRecoverTl2004.test.ts` —
  "takeover: a kill at any lifecycle point leaves a human-gated state that
  recovery NEVER advances (takeover-pending/taken-over hold)" and
  "takeover-pending / taken-over NEVER move (human-only transitions)".
- `extensions/flauz-agent/package.json` — `contributes`: participant
  description + exactly four participant commands (all "(human gate)"),
  one tool (`flauzTerminal`), four view commands — zero takeover text.
- `extensions/flauz-agent/src/extension.ts` — participant registration and
  command registrations; no user-facing takeover surface.
- `extensions/flauz-workspace/flauz-guide.md` — "States and recovery"
  documents error/retry/cancel; takeover is absent.
- `docs/FLAUZ-PROGRAM/TL4-PRODUCT-HANDOFF.md` checklist item 9 —
  "require/handle approval or takeover" (the journey stage this row audits).
- Machine check: `build/flauz/discovery/p2-003-discovery-gate.mjs` row
  DA16 — the user-facing corpus scan found **zero** matches for
  `/takeover|take over/i` (pinned known gap `DA16:product-wide`;
  `--strict` fails on it today).

## Owning domain

TL2 (Agent OS — the takeover transitions are orchestration semantics; the
user-facing verb is the capability owner's to define).

## Proposed contract change

Land the takeover affordance as the fifth human gate, mirroring the
comprehensible-approval pattern:

1. A participant slash command `/takeover` (description names the human
   gate, e.g. "Take a stuck step over by hand (human gate)") wired to
   `flauz.orch.requestTakeover` + `acceptTakeover` on the active task's
   stuck step, with the same evidence discipline LEG 6 proved
   (attributed rows in the shared ledger).
2. An Agent Sessions affordance on the stuck/active row ("Take over
   step…") with the `taken-over` state rendered legibly (icon +
   description), so the escape hatch is visible exactly where the stuck
   work is.
3. A "Takeover" paragraph in the guide's "States and recovery" section:
   when to use it, what the agent may not do during it, and that the
   takeover is journaled.

## Exact owning TL

TL2 (orchestration semantics own the takeover transition and its gating;
the participant command rides flauz-agent — TL2's bridge — with the guide
paragraph coordinated through TL4 at the station).

## Acceptance test

1. `node build/flauz/discovery/p2-003-discovery-gate.mjs --root . --require --strict`
   exits 0 for row DA16 (the `DA16:product-wide` pin retires).
2. Runtime re-verification (TL2/TL4 station): with a task gated on a
   pending approval, `/takeover` (or the session row command) performs
   the request→accept sequence, the step completes as the human, and the
   evidence rows appear in the ledger with human attribution — the LEG 6
   behavior through a user-facing affordance.
3. The kill-recover matrix tests stay green (the transitions themselves
   are untouched — this finding adds the surface, not the semantics).

## Architecture-change requirement

No. The takeover transitions, gating and evidence discipline are landed
and proven; this finding surfaces them (participant command, view row,
guide text). No core, seam or service contract changes.
