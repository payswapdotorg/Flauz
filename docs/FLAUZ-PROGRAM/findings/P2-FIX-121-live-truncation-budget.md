# P2-FIX-121 — The live lane's default completion budget truncates long-form answers mid-JSON (finish_reason: length at ~4096 tokens)

Finding domain: TL-A (dogfood-surfaced, the dogfood harness live-lane request shape) · Found by: A-PROD-003-W4 (the post-120 live re-run, 2026-10-01) · Status: REGISTERED (not implemented — the A3 law)

## Observable dogfood behavior

The W4 live re-run (records banked at `build/flauz/dogfood/records/aprod003-w4-live-2026-10-01/`): with the 120 extraction fix landed, the provider-switch exercise passed 6/6 live again — but the exploration answer STILL failed the parse with the identical raw-parse error. The station's forensic probe with the EXACT exercise question:

```text
finish_reason: length | completion_tokens: 4095 | len: 14425
tail: "... {
      "file": "extensions/flau"     (truncated mid-JSON)
fences: 1                                       (the opening fence only — no closing fence)
```

The platform's default completion budget (~4096 tokens) truncates the real 23-consumer map mid-JSON: the closing fence never arrives, the 120 extraction correctly finds no complete pair, and the raw parse fails honestly. The W3 answer (14,826 chars) was the SAME truncation class — the 120 prose-adjacency fix was necessary but not sufficient.

## The friction

Long-form structured answers (the real exploration map) legitimately exceed ~4k completion tokens. The driver's live-lane ask sets NO max_tokens, so the platform default caps it. A control probe with `max_tokens: 20000` completed the same answer class cleanly (finish_reason: stop, fence pair complete).

## Evidence + runtime level

`live-provider` (the real glm-4-plus through the station's gateway; the probe receipts quoted verbatim above; the W4 friction rows banked).

## Candidate acceptance shape (for the implementing wave)

The driver's live-lane ask sets an explicit completion budget on the request (e.g. max_tokens 32768, or an env knob `FLAUZ_DOGFOOD_LIVE_MAX_TOKENS` with a generous default); the ask's receipt/detail surfaces the finish_reason (a `length` finish is a visible truncation, never a silent ok); the fake lane's shape unchanged. Acceptance: the live exploration run's answer parses (or fails with a VISIBLE truncation marker), never a bare raw-parse error again.
