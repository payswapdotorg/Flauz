# P2-FIX-118 — Real-model answers arrive markdown-fenced; the answer contracts parse raw JSON only

Finding domain: TL-A (dogfood-surfaced, the Agent OS answer contracts) · Found by: A-PROD-003-W2 (the station-side live-provider dogfood run, 2026-10-01) · Status: REGISTERED (not implemented — the A3 law)

## Observable dogfood behavior

The W2 live-provider run (records banked): the live glm-4-plus answered
the provider-configuration question with a CORRECT-shaped JSON payload
wrapped in a markdown code fence:

```text
```json
{
  "schema": "flauz.dogfood-switch-answer/v1",
  ...
}
```
```

The exercise's answer verification rejected it: **"the completion is not
valid JSON: Unexpected token '`', "```json\n{\n" is not valid JSON"** —
the `switch.answers-verified` check failed on formatting alone.

## The friction

This is the classic real-model integration behavior: models wrap
structured answers in markdown fences. The fake lane never fences
(computed answers), so every answer contract that parses raw JSON passes
fixture lanes and breaks on the first live model. Any dogfooded
agent-session that expects structured model output needs fence-tolerant
extraction (or a prompt discipline that is at best unreliable).

## Evidence + runtime level

`live-provider` (the real vendor answer, captured verbatim in
`provider-switch.report.json` — the `answerProblems` row quotes the exact
parse failure).

## Candidate acceptance shape (for the implementing wave)

The answer-contract parsing layer accepts a leading/trailing markdown
fence around JSON payloads (strip + parse, the fence never silently
accepts MALFORMED JSON inside); the strict raw-JSON path stays the
default for machine-to-machine lanes; the dogfood driver's answer
verification uses the tolerant path for live lanes.
