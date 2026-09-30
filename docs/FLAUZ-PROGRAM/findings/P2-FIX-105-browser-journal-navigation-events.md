# P2-FIX-105 — the browser session journal does not record navigation events (allow/deny verdicts and committed URLs are not on-disk session evidence)

Observed by P2-002 Worker A (journey runtime) while executing LEG 6 (use
browser) of the acceptance journey on the pinned base `7558680d`.

- **Observable behavior:** the on-disk browser session journal
  (`.flauz/browser-sessions.jsonl`, `flauz.browser-session-journal/v0`)
  records only `['opened', 'state-changed', 'closed', 'failed']` events
  (`extensions/flauz-browser/src/runtime/journal.ts`
  `BROWSER_SESSION_JOURNAL_EVENTS`). A navigation — allowed OR denied —
  writes NO journal record: after `open -> navigate(allowed) ->
  navigate(denied) -> close` the journal carries exactly 2 rows
  (`opened` at state active, `closed` at state closed). A user or agent
  inspecting a session's on-disk provenance sees that the session opened and
  closed but NOT where it navigated, what the policy decided (the
  fail-closed denial that sent ZERO wire commands leaves no durable trace),
  or the committed URL. The navigation verdict is returned to the caller and
  pinned only in the battery transcripts, not in the product's session
  evidence surface.
- **Evidence + runtime level:** runtime-real — reproduced during the
  acceptance journey (LEG 6, receipt `leg-06-browser-use.json`, check
  `leg6.session-journal-on-disk`: 2 records) and confirmed in isolation
  against the real headless Chromium: `JOURNAL: "opened" | state: active`
  then `JOURNAL: "closed" | state: closed` after a successful navigation.
  The journal-vocabulary constant is read directly from the pinned base
  source.
- **Owning domain:** browser runtime evidence capture (the session journal
  contract); TL4 holds the acceptance interest.
- **Proposed contract change (if any):** extend the journal event vocabulary
  with a navigation event (decision allow/deny, target URL, committed URL,
  whether any wire command was sent — the J3 fail-closed row) so a session's
  navigation provenance is durable on disk alongside its lifecycle. A
  schema-version call is needed (the journal envelope is versioned).
- **Exact owning TL:** TL3 (browser runtime/security + evidence capture).
- **Acceptance test:** after `open -> navigate(allowed) ->
  navigate(denied) -> close`, the on-disk journal carries the two navigation
  rows (allow + committed URL; deny + zero-commands) in addition to
  opened/closed, and the leg-6 receipt's journal-row census becomes 4.
- **Architecture-change requirement:** no (additive journal event type; the
  journal is already the session's evidence surface — no new store).
