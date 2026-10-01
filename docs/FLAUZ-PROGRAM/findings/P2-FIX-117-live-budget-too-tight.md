# P2-FIX-117 — Live-model long-form generation exceeds the request wall-clock budget (the typed TIMEOUT fires on real exploration workloads)

Finding domain: TL-A (dogfood-surfaced, the Model Fabric request budgets) · Found by: A-PROD-003-W2 (the station-side live-provider dogfood run, 2026-10-01) · Status: REGISTERED (not implemented — the A3 law)

## Observable dogfood behavior

The W2 live-provider run (records banked at
`build/flauz/dogfood/records/w2-live-provider-2026-10-01/`): the
exploration exercise's live model call — the real glm-4-plus generating the
evidence-ledger consumer map over the real tree — ran **45,030 ms** and
failed with the **typed provider failure TIMEOUT (short-backoff, 3
attempts): "request exceeded its wall-clock budget"**. The friction row:
`{"kind":"provider-failure","detail":"the exploration turn failed with the
typed provider failure TIMEOUT (short-backoff, 3 attempts)..."}`.

The fake lane (W1) answers instantly (computed server-side), so the
budget class was never exercised realistically until the live run.

## The friction

Real long-form generation workloads (repository maps, multi-file analyses)
legitimately take minutes on live models; the request budget class that
the retry contract enforces defaults to a window that treats them as
timeouts. A dogfooded agent doing real exploration work dies at the
budget even though the vendor is healthy and streaming.

## Evidence + runtime level

`live-provider` (the real vendor through the station's transparent
header-injecting gateway — the live-provider drill's merge-under-adapter-
headers methodology; the adapter, routing decision, retry rounds and typed
failure are all the product's real code paths).

## Candidate acceptance shape (for the implementing wave)

The wall-clock budget is per-call configurable through the session/task
envelope (a `wallClockBudgetMs` on the ask or the provider-lane config)
with a live-realistic default class for long-form work; the typed TIMEOUT
keeps its bounded-retry semantics; the friction log records the budget
actually used. The dogfood driver grows the env knob for W3.
