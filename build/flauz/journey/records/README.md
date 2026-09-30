# build/flauz/journey/records/ — P2-002 journey receipts

The per-leg evidence receipts of the P2-002 full product acceptance journey
(P2-002 Worker A — journey runtime; see `docs/FLAUZ-PROGRAM/acceptance/
p2-002-journey-runtime.md`, the acceptance artifact).

## How the receipts are produced

The gate `build/flauz/journey/p2-002-journey.mjs` spawns the runtime drill
(`build/flauz/journey/journey.drill.ts`) with
`FLAUZ_JOURNEY_RECORDS=<this dir>`. Every leg writes exactly one receipt file
here (overwriting any previous run's file for that leg); the summary document
is written last. The gate then verifies every receipt (schema, leg identity,
verdict, evidence level) — see the gate header for the enforcement model.

Re-run (the lead's station entry point):

```sh
node build/flauz/journey/p2-002-journey.mjs --root . --require
# or re-verify an existing records dir without re-running the drill:
node build/flauz/journey/p2-002-journey.mjs --verify build/flauz/journey/records
```

LEG 06 (browser-use) requires a real headless Chromium CDP WebSocket endpoint
in `FLAUZ_CDP_ENDPOINT` (the TL3-003/session/budgets drills document the
launch pattern); without it the leg records verdict SKIP with the reason and
`--require` fails the gate. LEG 04 upgrades to `live-provider` when
`FLAUZ_LIVE_PROVIDER_BASE_URL` / `_API_KEY` / `_MODEL` are present (the
repo's TL2-H1 live-provider drill is then invoked as the leg's live row).

## File format

One file per leg, named `leg-<NN>-<slug>.json` (the 14 canonical legs), plus
`journey-summary.json`.

```jsonc
// leg-NN-slug.json (schema flauz.p2-002-journey-receipt/v1)
{
	"schema": "flauz.p2-002-journey-receipt/v1",
	"wo": "P2-002",
	"worker": "A",
	"leg": 6,                        // 1-based canonical leg number
	"slug": "browser-use",
	"name": "use browser",
	"verdict": "PASS",               // PASS | FAIL | SKIP (never silent)
	"evidenceLevel": "runtime-real", // fixture | simulated | local-real | runtime-real | live-provider
	                                 // (SKIP legs record "unavailable")
	"assertions": { "pass": 6, "fail": 0 },
	"checks": [                      // every target assertion of the leg
		{ "id": "leg6.allowed-navigation-commits", "ok": true,
		  "detail": "the allowed navigation COMMITTED ..." }
	],
	"startedAt": "2026-09-30T05:41:12.345Z",  // ISO-8601, real wall clock
	"durationMs": 812,                          // integer milliseconds
	"command": "node --experimental-strip-types build/flauz/journey/journey.drill.ts",
	"firstFailing": "...",           // present iff verdict is FAIL
	"skipReason": "...",             // present iff verdict is SKIP (fail-closed: never blank)
	"notes": "..."                   // honest level caveats (e.g. the live-provider residue)
}
```

`journey-summary.json` (schema `flauz.p2-002-journey/v1`) carries the whole
verdict document: `wo`, `worker`, `rung: "runtime"`, the full `legs` array
(the leg verdicts), `summary {pass, fail, skip}` and a per-slug `levels` map.

## Determinism

Verdicts, assertion counts and check details are deterministic for a given
repo state; `startedAt`, `durationMs` and the ephemeral ports/ids embedded in
details (session ids, tmp roots, wire ports) vary per run. A fresh run
OVERWRITES these files — the committed copies are the receipts of the
delivery's verification run (the acceptance artifact records that run's
command and result).

The receipts are JSON (not JavaScript): no eslint allowlist implications.
