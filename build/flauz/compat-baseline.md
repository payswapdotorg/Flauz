# Compat Battery Baseline — TL4-003 (Worker B)

The authoritative record of the Code OSS compatibility battery
(`build/flauz/scripts/compat-battery.mjs`, spec:
`docs/FLAUZ-PROGRAM/TL4-COMPAT-BATTERY.md`) running clean on the product
line. Re-record at every upstream sync (DL-11 cadence) and whenever the
battery grows a family — a shrinking row count is itself a signal.

## Run record

| Field | Value |
|---|---|
| Date | 2026-09-27 |
| Product head verified | `4c96dad50d6fe87ded1599ec561c54d37573e7b1` (main at the TL4-003 branch point; the branch adds only battery/fixtures/docs/CI files, so the stock surface diff is identical at the branch head — re-verified post-commit) |
| Upstream reference | `origin/upstream/main` = `9bf9ae764da438b1234a8243dc9e47173ef58ee7` |
| Command | `node build/flauz/scripts/compat-battery.mjs --require` |
| Node | v24.21.0 (sandbox; CI uses 20) |
| Allowlist | `build/flauz/compat-allowlist.json` — 0 entries |
| Exit code | **0** (`--require`: nothing skipped, nothing failed) |

## Counts

**1887 rows — 1887 PASS · 0 FAIL · 0 SKIP** (additions allowed: 0 — current
main adds stock-side nothing; the Flauz additions live in the six flauz-*
extensions + `product.flauz.json`, outside the stock diff).

Row breakdown:

| Row class | Rows |
|---|---|
| L1 source purity (fork-critical-guard invocation) | 1 |
| Stock manifests present + parse (96 extensions) | 96 |
| `commands/*` | 495 |
| `configuration/*` | 762 |
| `keybindings/*` | 90 |
| `menus/*` | 112 |
| `submenus/*` | 14 |
| `views/*` | 6 |
| `viewsContainers/*` | 3 |
| `product.json` identity rows (46 stock keys; identity set: defaultChatAgent, extensionEnabledApiProposals, nameLong, nameShort, version) | 46 |
| Root `package.json` scripts/dependencies/devDependencies names | 255 |
| Positive control (product.flauz.json + six flauz built-ins) | 7 |
| **Total** | **1887** |

## Output (verbatim, human mode)

```text
compat-battery: node 24.21.0, root /home/z/flauz
compat-battery: upstream origin/upstream/main (9bf9ae764da438b1234a8243dc9e47173ef58ee7)
compat-battery: product  HEAD (4c96dad50d6fe87ded1599ec561c54d37573e7b1)
compat-battery: stock manifests protected: 96, flauz manifests at product side: 6
compat-battery: product identity set (from product.flauz.json): defaultChatAgent, extensionEnabledApiProposals, nameLong, nameShort, version
compat-battery: allowlist /home/z/flauz/build/flauz/compat-allowlist.json — 0 entries, 0 used, 0 unused
layer 1 (source purity):        1 rows — 1 PASS · 0 FAIL · 0 SKIP
layer 2 (contribution diff):    1886 rows — 1886 PASS · 0 FAIL · 0 SKIP
compat-battery: additions allowed (Flauz-side adds): 0
compat-battery: verdict: 1887 rows — 1887 PASS · 0 FAIL · 0 SKIP — PASS (Flauz is additive over stock)
```

## Fixture-matrix receipt (same session)

`sh build/flauz/scripts/verify-fixtures.sh` → **ALL 47 CASES AS EXPECTED
(0 deviations)**, exit 0 — including the 19 compat-battery rows (14 fixture
trees + `--require` escalation + `--no-fail` + usage-error + the real-repo
`--require` run).
