# Activation - the runtime wiring spine (CR-001)

Phase C (ZC-001..ZC-010) landed typed CONTRACTS. Phase C-R wires them into the
real runtime. This subtree is THE SPINE: a typed, machine-checked wiring map
from every ZC contract family to the ONE Flauz authority that owns its
runtime, so that no later CR wave can accidentally build a parallel
implementation of something Flauz already owns.

The map lives in `common/wiring.ts` (pure data + types, zero imports - the
sibling law). The pure resolvers and the law-checker live in
`common/coverage.ts`. The machine-check suite lives in
`test/common/wiring.test.ts`.

## The honest bar

A capability is `wired` ONLY when a REAL product/runtime module on disk TODAY
(an `extensions/flauz-*/**` runtime module or a `build/flauz/**` runtime the
product consumes) actually consumes or enforces the contract family. A mocha
suite pinning a contract is NOT wiring. When in doubt: `gap` + a gapOwner +
a precise gapNote. The TL re-reviews every judgment at the station; a promoted
label is a voiding offense.

| evidence label | meaning |
|---|---|
| fixture | contract pinned by a suite only - NOT wiring |
| simulated | fake lane, real seams (the dogfood harness exercising real runtime modules) |
| local-real | real local state, no fake lane |
| runtime-real | real runtime code paths |
| live-provider | live external provider |
| production-real | production traffic |

ZC-001 (the common contract families, the typed projections over the live
runtime surface) was initially judged `wired` because the dogfood harness
exercises the real agent seams (`extensions/flauz-agent/core/orchStore.mjs`,
`extensions/flauz-agent/core/a2a.mjs`) that the common families project. The
station re-review corrected this: the AUTHORITIES are live and dogfood-exercised
(simulated evidence), but the ZC-001 PROJECTION MODULES themselves have no
runtime consumer on disk - no extension or harness imports them. The honest
state for every one of the ten capabilities today is `gap` (fixture evidence:
contract suites pin them; nothing consumes them). This IS the Phase C-R story:
contract layer complete, runtime activation pending - exactly what CR-002..010
exist to close, one authority-owned runtime consumer at a time.

## How to run the checks

Run everything FROM THE REPO ROOT. The existence matrix resolves every cited
path against `process.cwd()`.

        npm i --silent --no-audit --no-fund typescript@5.9.3 @types/node @types/mocha
        tsc -p build/flauz/zcode-patterns/activation/tsconfig.json --skipLibCheck --types node,mocha
        NODE_OPTIONS=--import tsx npx mocha --ui tdd build/flauz/zcode-patterns/activation/test/common/*.test.ts
        NODE_OPTIONS=--import tsx npx mocha --ui tdd build/flauz/dogfood/dogfood.test.ts build/flauz/dogfood/browser-policy.dogfood.test.ts
        grep -nE 'Date\.now|Math\.random' build/flauz/zcode-patterns/activation/**
        grep -nE '^import|^export .* from' build/flauz/zcode-patterns/activation/common/*.ts

The scoped tsc uses the isolated runner recipe from
`build/flauz/dogfood/README.md`. The last two greps MUST return zero matches.

## Authority table

| authority | owner | root | note |
|---|---|---|---|
| AGENT_OS | flauz-agent | extensions/flauz-agent | orchestration store, A2A seams, service/runtime/policy/recovery/routing cores |
| WORKSPACE_OS | flauz-workspace | extensions/flauz-workspace | workspace API surface |
| EXECUTION | flauz-execution | extensions/flauz-execution | contracts, runtime, journal, acquisition, adapters, continuity |
| WORKFLOW | flauz-workflow | extensions/flauz-workflow | workflow runtime |
| MEMORY | flauz-memory | extensions/flauz-memory | the real store (src/memory.ts) |
| LAB | flauz-lab | extensions/flauz-lab | lab runtime |
| BROWSER | flauz-browser | extensions/flauz-browser | browser automation runtime |
| MODELS | flauz-models | extensions/flauz-models | model/provider surface |
| RESOURCES | flauz-resources | extensions/flauz-resources | tool/resource execution |
| INTEGRITY | flauz-integrity | extensions/flauz-integrity | verification and integrity gating |
| ENVIRONMENTS | flauz-environments | extensions/flauz-environments | environment provisioning |
| ACCEPTANCE | flauz-acceptance | extensions/flauz-acceptance | acceptance evidence, gates, parity matrices |
| CAPABILITY_EXCHANGE | build/flauz/capabilities | build/flauz/capabilities | packs, sources, commands |

## Gap table

Every capability below is accounted for. Wired rows name the authority and
the evidence; gap rows name the CR wave that owns the activation.

| capability | state | authority | evidence | gap owner |
|---|---|---|---|---|
| ZC-001 common families | gap | AGENT_OS | fixture | CR-002 |
| ZC-002 background agent | gap | AGENT_OS | fixture | CR-002 |
| ZC-003 hook bus | wired | AGENT_OS | local-real | — (the CR-003 landing) |
| ZC-004 observatory | wired | EXECUTION | local-real | — (the CR-004 landing) |
| ZC-005 memory | wired | MEMORY | local-real | — (the wave-4 landing) |
| ZC-006 packs | gap | CAPABILITY_EXCHANGE | fixture | CR-006 |
| ZC-007 sources | gap | CAPABILITY_EXCHANGE | fixture | CR-007 |
| ZC-008 commands | gap | RESOURCES | fixture | CR-008 |
| ZC-009 cli | gap | AGENT_OS | fixture | CR-009 |
| ZC-010 parity | gap | ACCEPTANCE | fixture | CR-010 |

## Reconciliation record (station)

The worker authored this map in a text-only lane (no disk access). The station
reconciled it against the base enumeration before commit: the ZC-001
`contractModules` list was corrected from pattern-inferred names to the six
real modules (`backgroundAgent.ts`, `hooks.ts`, `memoryProjection.ts`,
`planContinuity.ts`, `replayResume.ts`, `runHealth.ts`); the ZC-001 `wired`
judgment was corrected to `gap` (the honest bar: authorities live, projections
unconsumed); the test walk was corrected to compare repo-relative paths. The
coverage walk, existence matrix, and invariant gates now run green at the
landed head - THE DISK WINS, enforced.