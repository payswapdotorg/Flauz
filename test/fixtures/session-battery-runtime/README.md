# Session-battery runtime fixtures (TL4-007)

The RUNTIME rung of the whole-session acceptance battery
(spec: `docs/FLAUZ-PROGRAM/TL4-SESSION-BATTERY.md` section 4). The pinned
artifact here is produced ONLY by the drill
`extensions/flauz-workflow/test/canaries/session-battery-runtime.drill.ts`
running the four journeys (J1-J4) over the REAL ports: the real
`CdpEndpointHost` + `BrowserSessionManager` against a real headless
Chromium over a real CDP WebSocket (`FLAUZ_CDP_ENDPOINT`), and the real
`LocalProcessExecutor` (real child processes, real on-disk state) for the
environment leg.

## Files

- `golden-runtime.json` -- the pinned NORMALIZED runtime transcript
  (schema `flauz.session-battery-runtime/v1`). Produced by the drill's
  own real run against Chrome for Testing 153.0.8010.12 (headless=new).
- `../session-battery-runtime-doctored/golden-runtime.json` -- the
  one-value-doctored copy (a RAW ephemeral port leaked into the pinned
  URL). The `--check-transcript` mode MUST fail on it (exit 1) -- pinned
  in `build/flauz/scripts/verify-fixtures.sh`. A gate that cannot fail
  is not a gate.

## The normalization table (the ONLY volatile classes normalized)

Real ports produce volatile values; the transcript normalizes exactly
these classes and pins EVERYTHING else by deep-compare. A difference
between the fixture rung's golden transcript
(`test/fixtures/session-battery/golden-transcript.json`) and the runtime
transcript that is NOT one of the rows below is a FINDING, never a
silent pass.

| # | volatile class | where it appears | canonical form |
| --- | --- | --- | --- |
| 1 | local-origin ephemeral port | `golden.browser.navigationVerdicts[].url` and `.committedUrl` | `http://127.0.0.1:<PORT>/...` (the literal placeholder `<PORT>`) |
| 2 | browser session ids (`flauz:browser:<hex>`), tab target ids, partition hex (`persist:flauz-<16hex>-<agent>`), harness pids, flat-protocol CDP session ids | nowhere -- the transcript contract distills these to event kinds and counts (unchanged from the fixture rung; the `--check-transcript` mode re-proves no raw value leaks) | distilled (counts/kinds) |
| 3 | timestamps (journal `ts`, ops-ledger `ts`, task events `ts`, ledger rows) | deterministic by the battery's injected clocks (the same stepping/fixed clock ports the fixture battery injects -- only the transport and executor ports changed rungs) | deterministic by injection |

## Contract deltas vs the fixture rung's golden transcript (reviewed, not silent)

The runtime transcript is deep-compared against THIS directory's pinned
artifact, not the fixture rung's; the reviewed differences between the
two documents are exactly:

1. `schema`: `flauz.session-battery/v1` -> `flauz.session-battery-runtime/v1`
   (honest rung identity; same row shapes).
2. `golden.browser.navigationVerdicts[0].url`:
   `https://welcome.example.com/` -> `http://127.0.0.1:<PORT>/welcome`.
   The fixture rung's allowed host is a FakeCdpTransport fiction (not
   real-network reachable); the runtime rung navigates a REAL local
   origin server (node:http on 127.0.0.1, ephemeral port), and the port
   is normalization class 1. The denied URL (`https://blocked.invalid/`)
   is pinned verbatim in BOTH rungs (a denied navigation sends ZERO
   commands, so it never touches the network).
3. `golden.browser.navigationVerdicts[0].committedUrl` (ADDITIVE row):
   the runtime rung pins the REAL committed URL observed over the wire
   (`Page.navigate` -> `Page.frameNavigated`), normalized per class 1.
   This is a strengthening (more pinned evidence), never a loosening.

Everything else -- the task event spine, ledger row count/kinds/uris,
artifact sha256, journal event sequence, drive-command counts (1 allowed
in J1; 0 after the J3 denial -- the hard fail-closed row), environment
op sequence + final state, workflow fragment rows, recovery
derivedFrom/new-evidence/history rows, continuity counts -- is IDENTICAL
to the fixture rung's golden transcript.

## Regeneration (promotion-ladder law)

```
# a real Chromium endpoint is required (the TL3-003 drill documents the launch):
chromium --headless=new --no-sandbox --disable-gpu --disable-popup-blocking \
          --remote-debugging-port=9222 --user-data-dir=/tmp/flauz-chrome about:blank
EP=$(curl -sS http://127.0.0.1:9222/json/version | node -e \
  "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>console.log(JSON.parse(d).webSocketDebuggerUrl))")
FLAUZ_CDP_ENDPOINT=$EP \
FLAUZ_SESSION_BATTERY_RUNTIME_RECORD=1 \
FLAUZ_SESSION_BATTERY_RUNTIME_FIXTURES=test/fixtures/session-battery-runtime \
  node --experimental-strip-types \
  extensions/flauz-workflow/test/canaries/session-battery-runtime.drill.ts
```

A regenerated `golden-runtime.json` MUST be REVIEWED diff-by-diff in the
PR that lands it (the promotion-ladder law -- no silent regeneration).
The zero-dep guard: `node --experimental-strip-types <drill>
--check-transcript test/fixtures/session-battery-runtime/golden-runtime.json`
fails (exit 1) if the artifact contains raw volatile values, a wrong
schema id, or a violated hard row -- wired into
`build/flauz/scripts/verify-fixtures.sh`, so every in-sandbox and CI
matrix run re-proves the discipline without any Chromium.

## SKIP policy

Without `FLAUZ_CDP_ENDPOINT` the drill exits 0 with
`session-battery runtime drill: SKIP (no FLAUZ_CDP_ENDPOINT)` (same
skip-vs-fail policy as the TL3-003 real-Chromium drill); the gate's
`--require` promotes a SKIP to a FAIL in CI evidence mode.
