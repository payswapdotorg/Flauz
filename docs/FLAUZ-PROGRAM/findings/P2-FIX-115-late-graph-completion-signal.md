# P2-FIX-115 — The graph-completion law's error arrives only at completion time (no early typed signal at step failure)

Finding domain: TL-A (dogfood-surfaced, the Agent OS orchestration UX) · Found by: A-PROD-003-W1 (the dogfood harness build, chat `0bd25529`) · Status: REGISTERED (not implemented — the A3 law: every dogfood defect becomes a registry item before implementation)

## Observable dogfood behavior

While driving the REAL OrchestrationStore/TaskService seams headlessly (the
dogfood harness, `build/flauz/dogfood/**`, landed PR #110), the worker hit
the fail-loud graph-completion law twice during development:

- an `ask()` issued before any lane selection;
- an illegal `completeGraph` over a failed step — correctly rejected as
  "fabricated completion".

Both were caught ONLY at the offending call site. But the symmetric case —
a step that failed via `finishStep(outcome: 'failed')` while the mission
graph has no remaining path to completion — produces NO signal at failure
time; the non-completable state surfaces only when a later `completeGraph`
is rejected.

## The friction

The developer loop is longer than it needs to be: the earliest moment the
product KNOWS the graph is doomed (the failed step) is not the moment it
TELLS the operator. A typed early signal at `finishStep(outcome:'failed')`
time — "this step's failure leaves the graph non-completable; call
failGraph or retry" — would shorten the loop and give the evidence ledger
a failure-time record instead of a completion-time rejection only.

## Evidence + runtime level

`local-real`: observed twice during the real seam-driven harness build
(the worker's §6 disclosure, PR #110); the seams are the product's real
code paths (no simulation of the store itself).

## Candidate acceptance shape (for the implementing wave)

A failed `finishStep` on a step whose failure leaves no completable path
emits a typed warning/result carrying the non-completable reason; the
ledger records the failure-time signal; existing legal completions stay
byte-identical in behavior (the completion-time rejection law unchanged).
