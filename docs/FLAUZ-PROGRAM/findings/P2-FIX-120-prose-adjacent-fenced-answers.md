# P2-FIX-120 — Prose-adjacent fenced answers: the live model surrounds the fenced JSON with prose (the 118 residual)

Finding domain: TL-A (dogfood-surfaced, the dogfood harness answer contracts) · Found by: A-PROD-003-W3 (the realistic live re-run, 2026-10-01) · Status: REGISTERED (not implemented — the A3 law)

## Observable dogfood behavior

The W3 live re-run (records banked at `build/flauz/dogfood/records/aprod003-w3-live-2026-10-01/`): with the W2.1 fixes in place, the provider-switch exercise passed **6/6 live** (the prompt-carried facts + the clean-fence tolerance both working) and the exploration model call streamed 14,826 chars in 40,044 ms under the configured 300,000 ms budget (the 117 fix working — no TIMEOUT). But the exploration answer STILL failed to parse:

```text
the completion is not valid JSON: Unexpected token '`', "```json\n{\n"...
```

A station probe confirmed the exact format: the live model emits the fenced JSON **followed by prose** (` ```json {...} ``` Success!`) — and the W2.1 fence stripper only strips a fence pair that ENDS the text (the TRAILING_FENCE regex requires only whitespace after the closing fence). Prose before/after the fence defeats it.

## The friction

This is the 118 class's second iteration: real models surround fenced JSON with conversational prose. The clean-fence-pair design (correctly conservative for machine lanes) is too narrow for the live lane's real behavior — the answer's payload IS there, correctly fenced, with commentary around it.

## Evidence + runtime level

`live-provider` (the real glm-4-plus; the probe receipt and the W3 friction rows banked in the records dir).

## Candidate acceptance shape (for the implementing wave)

The fence-tolerant path extracts the FIRST COMPLETE fenced block (leading fence line with optional info string ... matching closing fence) from anywhere in the text, and parses its body; prose before/after is allowed; the raw-JSON machine-lane default is unchanged; malformed JSON inside the extracted block still FAILS; a text with NO complete fence still falls to the raw parse (honest failure). Unit tests: fenced-with-trailing-prose, fenced-with-leading-prose, clean-fence (W2.1 shape), multiple-fences (first wins), no-fence, malformed-inside-fence.
