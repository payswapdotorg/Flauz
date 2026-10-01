# P2-FIX-203 — Delegation/A2A is invisible: no user-facing surface mentions the multi-agent capability

Finding domain: TL2 (Agent OS / A2A) · Found by: P2-003 (Worker B discovery audit, row DA11) · Status: READY-TO-CLAIM

## Observable user behavior

A user who wants part of a task delegated to a second agent — the
multi-agent capability the architecture ships — finds **nothing** in the
product:

- No view row, welcome, or command mentions delegation or A2A.
- The chat participant's description and its four slash commands
  (`/approve`, `/request-changes`, `/sign-off`, `/cancel`) never mention
  that another agent can take work over.
- The single contributed tool (`flauzTerminal`) describes only terminal
  confirmation.
- The shipped guide's capability tour never says a worker agent can be
  spawned.

The capability is real and proven: the orchestration protocol carries the
typed `flauz.orch.*` A2A surface, the file-backed A2A bus routes
`task-delegation` / `result-report` / `steering-relay` / `resource-claim`
messages, delegation contracts (`flauz.a2a.contracts/v1`) persist a typed
result schema before the delegation message is posted, and the journey
rehearsal's LEG 5 passed the full typed round-trip (route-decided,
delegation-sent, worker evidence in the shared ledger, result-report,
result-received). But it is reachable only programmatically. A user can
learn it exists solely by reading engineering docs (the flauz-workflow
README, the work registry) — exactly the docs-or-bust failure mode the
P2-003 audit exists to catch. The audit cannot even judge *how* a user
would request a delegation, because no user-facing verb for it exists.

## Evidence + runtime level

`local-real` (static contract over the real product sources at pinned base
`7558680d8c537cc724c5026ca4a637afc86a1d72`):

- `extensions/flauz-workflow/src/messaging.ts` —
  `A2A_MESSAGE_KINDS = ['task-delegation', 'result-report',
  'steering-relay', 'resource-claim']`; `task-delegation` "mirrors the AHP
  subagent spawn" contract.
- `extensions/flauz-workflow/README.md` — "DELEGATION CONTRACTS
  (`flauz.a2a.contracts/v1`, `.flauz/a2a/contracts/`)" and the coordination
  message tour — engineer-facing documentation of a shipped capability.
- `docs/FLAUZ-PROGRAM/WORK-REGISTRY.md` TL2-003 — DONE, including
  "multi-agent A2A routing".
- `docs/FLAUZ-PROGRAM/acceptance/tl2-agent-domain-journey-evidence.md`
  LEG 5 (A2A delegation) — PASS 8/8, fixture level.
- `build/flauz/packaging-parity.json` — `extensions/flauz-workflow`
  classified `web-blocked` service surface: headless by design, which is
  precisely why the capability needs a user-facing surface *elsewhere*.
- Machine check: `build/flauz/discovery/p2-003-discovery-gate.mjs` row
  DA11 — the corpus scan (every viewsWelcome contents, every command
  title/description, the participant description + its slash commands,
  every tool userDescription, the shipped guide, all five view sources)
  found **zero** matches for `/delegat|A2A|agent-to-agent/i` (pinned known
  gap `DA11:product-wide`; `--strict` fails on it today).

## Owning domain

TL2 (Agent OS — the A2A delegation capability and its user-facing verb).

## Proposed contract change

TL2 must decide and record one of two postures, then land it:

1. **Surface it (recommended for P3):** define the user-facing verb for
   delegation — minimum viable surface: one sentence in the participant
   description (e.g. "…can delegate steps to worker agents"), one
   participant followup on multi-step plans, and a "Multi-agent work"
   section in the shipped guide naming `.flauz/a2a/contracts/`. The
   Agent Sessions view then renders worker sessions with their
   `result-report` state.
2. **Record the intentional-hiding exemption:** if delegation stays
   agent-initiated and undocumented in v0, amend
   `docs/FLAUZ-PROGRAM/TL4-PREMIUM-UX.md` section 9 with the explicit
   exemption row (the pattern already used for the models no-failure
   marker), so the next audit reads a recorded decision instead of a
   silence.

## Exact owning TL

TL2 (the capability, its semantics and its user-facing verb are Agent OS
contracts; the surface files span flauz-agent participant — TL2's bridge —
and the TL4-owned guide, which TL2 coordinates through TL4 at the
station).

## Acceptance test

1. Posture 1: `node build/flauz/discovery/p2-003-discovery-gate.mjs
   --root . --require --strict` exits 0 for row DA11 (the
   `DA11:product-wide` pin retires — the word is machine-checkable on a
   user-facing surface).
2. Posture 2: the pin migrates to a documented-exemption row (gate reading
   the spec marker, the models no-failure precedent) — either way DA11
   stops being an unpinned silence.
3. Runtime re-verification (TL2/TL4 station): a user reading only
   in-product surfaces can state that agents can delegate steps to other
   agents; if posture 1, the guide/participant surfaces name the
   delegation flow.

## Architecture-change requirement

No. Posture 1 is participant description text, a guide section and view
row content over already-shipped TL2 seams; posture 2 is a spec row. The
A2A machinery itself is landed and proven — this finding is about its
discoverability, not its semantics.
