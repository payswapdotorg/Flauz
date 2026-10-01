# P2-FIX-119 — The provider-switch exercise's verification question is unanswerable by a bare live model (no tool/file access)

Finding domain: TL-A (dogfood-surfaced, the dogfood harness exercise design) · Found by: A-PROD-003-W2 (the station-side live-provider dogfood run, 2026-10-01) · Status: REGISTERED (harness-design finding — the fix is the harness's, not the product's)

## Observable dogfood behavior

The W2 live run's provider-switch exercise asks the model "what is the
current provider configuration?" and verifies the answer against the
workspace's real providers file + the routing-decision ledger. The live
model — a bare chat completion with NO tool or file access — returned a
well-formed but empty/default answer (`enabledDogfoodProviders: []`,
`routingDecisionCount: 0`). The fake lane "knew" the configuration only
because it computes answers server-side from the real files.

## The friction

The exercise's question design leaks the fake lane's god-view: it is
unanswerable by the very class of intelligence (bare live models) the
exercise exists to test. The verification then fails for the WRONG reason
(the model cannot see the files, not because switching misbehaved —
switching itself worked perfectly: both live answers returned in ~1.1s,
the typed failure + recovery exercised cleanly, 1188 ms recovery).

## Evidence + runtime level

`live-provider` (the records banked under
`build/flauz/dogfood/records/w2-live-provider-2026-10-01/`).

## Candidate acceptance shape (for the implementing wave)

The exercise carries the workspace facts (providers file content, the
routing-decision tail) IN the prompt and asks the model to report them
(the model's job becomes reading + faithful reporting — a real
capability test for a bare model); the verification stays strict. The
prompt change is harness-only; no product surface is touched.
