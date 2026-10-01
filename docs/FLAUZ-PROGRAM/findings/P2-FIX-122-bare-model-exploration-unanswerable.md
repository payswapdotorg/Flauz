# P2-FIX-122 — The exploration exercise demands a capability a bare live model cannot have (repo-wide static analysis without file access)

Finding domain: TL-A (dogfood-surfaced, the dogfood harness exercise design — the 119 class's deeper sibling) · Found by: A-PROD-003-W5 (the full-fix live run, 2026-10-01) · Status: REGISTERED (harness-design finding — the fix belongs to the exercise design wave)

## Observable dogfood behavior

The W5 live run (records banked at `build/flauz/dogfood/records/aprod003-w5-live-2026-10-01/`): with ALL FOUR realism fixes in (the 300 s wall clock, the fence extraction, the 32768-token completion budget, the prompt-carried facts for the switch exercise), the harness machinery is now fully live-capable:

- `explore.model-call-ok` — TRUE (1,130 chars streamed, 3,978 ms, the finish_reason surfaced in the receipt);
- `explore.answer-parses` — TRUE (the answer document parses; the W2/W3/W4 parse failures are CLOSED);
- `provider-switch` — **6/6 PASS live** (the facts + fences + typed failure + recovery all working).

But the exploration exercise's knowledge checks failed honestly:

```text
explore.map-sound      FALSE — every claimed entry re-reads as a real ledger import (0/7 sound)
explore.map-complete   FALSE — the map misses 23 of the 23 real consumers
explore.map-100-percent FALSE — claimed 7 vs real 23; verified=false
```

The live model produced a well-formed, schema-conformant answer with SEVEN PLAUSIBLE-BUT-HALLUCINATED entries — zero re-read as real imports, zero of the 23 real consumers found. The model cannot see the repository; the question demands repo-wide static analysis.

## The friction (the honest design boundary)

The exploration exercise was designed against the fake lane's god-view (server-side computation over the real tree). For a bare live model the task is unanswerable — the 119 class generalized: ANY exercise whose verification requires workspace/tree facts must either carry those facts in the prompt (the 119 fix — feasible for small facts like the provider config, NOT for a 20k-file tree) or exercise the agent-with-tools surface (the browser/environment/tool lanes — the deeper dogfood waves).

## Evidence + runtime level

`live-provider` (the full W5 record set: the receipt with the finish_reason surfaced, the verification receipt with the 0/7 + 23/23-missed detail, the friction rows).

## Candidate acceptance shape (for the exercise-design wave)

The exploration exercise splits into: (a) the BARE-MODEL lane — the question reframed to what a bare model can honestly do (e.g., an embedded tree EXCERPT + "report the consumers in this excerpt", verified against the excerpt — a real capability test); (b) the TOOLS lane — deferred to the agent-with-tools dogfood wave (the browser/environment/multi-agent dimensions) where the model can actually read the tree. The fake lane keeps the full-tree question (its computation IS the ground truth check). No product surface touched.
