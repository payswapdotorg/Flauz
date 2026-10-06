---------------------------------------------------------------------------------------------
 Copyright (c) Flauz contributors. All rights reserved.
 Licensed under the MIT License. See LICENSE in the repository root for license information.
---------------------------------------------------------------------------------------------

# the journey battery (CR-011, wave 1)

The seven canonical Phase C-R journeys as a runnable harness with
HONEST per-step statuses: `runnable-now` (executes against real seams
today) vs `pending-wiring` (a typed record naming the owning CR --
never faked, never reported as passing).

## The journeys

| id | steps | runnable | pending | labels |
|---|---|---|---|---|
| journey-1-coding | 8 | 8 | 0 | 8 simulated (driver: agent-delegation) |
| journey-2-research | 8 | 7 | 1 (CR-005, memory) | 7 simulated (driver: tools-exploration) |
| journey-3-multi-agent | 7 | 7 | 0 | 7 simulated (driver: agent-delegation) |
| journey-4-capability | 9 | 0 | 9 (CR-006 x5, CR-007 x1, CR-008 x3) | -- |
| journey-5-recovery | 7 | 6 | 1 (CR-004, cold replay) | 6 local-real (the reload drill) |
| journey-6-cli | 8 | 8 | 0 | 8 local-real (the in-process CLI legs) |
| journey-7-unsafe-capability | 5 | 0 | 5 (CR-008) | -- |

Totals: 52 steps -- 36 runnable-now (22 simulated, 14 local-real),
16 pending-wiring.

## The evidence-label law

Driver-exercised legs are `simulated` (the fake model lane over REAL
seams -- never promoted). The J5 reload drill and the J6 CLI legs are
`local-real`. Pending steps carry NO label, only the pendingOwner.

## The runner

`runBattery({ root, runId?, driverRunner?, clock? })` executes the
runnable-now journeys: the J1/J2/J3 legs invoke THE EXISTING dogfood
driver as a child process (the full run -- the driver's usage header
documents no per-exercise selection flag, so receipts are selected
from its output; the order's pre-authorized fallback), the J5 reload
drill and the J6 CLI legs run in-process through the CLI's real
service-context port. Receipts are deterministic: two runs over the
same root with the same inputs are byte-identical modulo the runId.
The battery writes NOTHING outside its given root (the driver child
gets --out and TMPDIR inside the root and a sanitized environment
with no live-provider contract present).

## The CR fill-in plan

- CR-002/003 (approvals live surface): flips approval.list/respond
  and the J6 approval leg from typed refusal to wired.
- CR-004 (cold replay): flips replay.* and the J5 replay step.
- CR-005 (memory runtime): flips the J2 persist-memory step.
- CR-006/007/008 (capability registry/verify/safety): flip J4 (all
  nine steps), J7 (all five), capability-discovery.*.

## Tests

	NODE_OPTIONS=--import tsx npx mocha --ui tdd build/flauz/journey/battery/battery.test.ts