# DH-013 · the cross-industry harness acceptance family (`build/flauz/harness/acceptance/`)

SPEC-first charter (registry row **DH-013, the FINAL row of the Domain
Harness OS sequence**, "cross-industry harness acceptance";
ARCHITECTURE-LOCK §12.5 the domain-harness law — *"Industry
specialization is a harness over the universal Flauz core, not a fork"* —
and §12.6 the no-new-authority law). DH-013 runs the integrated
acceptance journey across FOUR representative industries — **software,
finance, healthcare, construction** (all REAL members of the frozen
`HARNESS_INDUSTRIES` vocabulary) — and verifies that each harness is
COMPOSED from reusable contracts, configuration, content and
capabilities, never a separate industry fork. The instrument assesses
completeness, role composition, workflows, policies, evidence,
approvals, UI behavior, capability gaps and task execution through the
EXISTING Flauz authorities, and registers every uncovered gap honestly:
**a passing framework test does not prove industry content exists or
that an end-to-end user journey is operational — this report states
exactly what is and is not proven.**

> **The DH-GAP-2 wave (2026-10-16)** re-pinned this family to the
> post-GAP-1 truth: the gap ledger's rows 1-2 are CLOSED (the closures
> recorded IN the rows, never by silent removal), all four fixtures
> carry curated benchmarks (the two binding modes), the content is
> deepened to the declared censused representativeness bar (six roles /
ten terms / four tasks / four bodies / four packs / two profiles per
> industry), and the battery grew 134 → 161.

## The four-industry map (the frozen acceptance lane)

| industry | benchmark leg | the honest gap |
| --- | --- | --- |
| `software` | **evaluated** — the curated base-registry benchmark (`regression-suite-health`) bound to the REAL three SE scenarios (`scenario-se-bugfix-regression`, `scenario-se-feature-addition`, `scenario-se-flaky-investigation`), the DH-09 shapes with the honest hypothesis / limitations / `evidenceLevel: 'fixture'` | registers the four OPEN rows (rows 1-2 are closed — the closures ride the ledger verbatim) |
| `finance` | **evaluated** — the curated industry-extension benchmark (`lending-operations-health`) binding the finance world's OWN three scenarios (`scenario-finance-reconciliation-discrepancy`, `scenario-finance-regulatory-report-validation`, `scenario-finance-payment-failure-triage`) through the combined catalog | registers the four OPEN rows |
| `healthcare` | **evaluated** — the curated industry-extension benchmark (`clinical-operations-health`) binding the healthcare world's OWN three scenarios through the combined catalog | registers the four OPEN rows |
| `construction` | **evaluated** — the curated industry-extension benchmark (`site-delivery-health`) binding the construction world's OWN three scenarios through the combined catalog | registers the four OPEN rows |

Each industry is one CURATED FIXTURE MODULE (`industries/software.ts`,
`industries/finance.ts`, `industries/healthcare.ts`,
`industries/construction.ts`) — pure frozen data: the DH-02 company
profile, the DH-03 six roles, the DH-04 ten terms of art, the DH-05
four task templates (term-resolved), the DH-06 four bodies
(role-resolved), the DH-07 four packs (body-resolved), the DH-08 two
policy profiles (REAL permission ids / risk tiers / evidence rungs /
KPI dimensions) and the DH-09 curated benchmark in one of the two
frozen binding modes. The **BASE-REGISTRY binding** (the plain
`BenchmarkEntry`, software only) binds the REAL three SE scenarios of
the landed base registry. The **INDUSTRY-EXTENSION binding** (the
wrapped `IndustryBenchmarkBinding`) binds the industry's OWN world
scenarios through the lab industry extension registry's combined
catalog (`getTaskScenario` / `generateTaskInstances`, imported by
reference — never a second registry, never a second engine). The DH-09
record each journey composes still carries only base-registry-bound
entries (the landed DH-09 scenario-binding law is never forced): the
software journey composes its curated entry; the three industry
journeys and any world-less fifth industry compose the runner-derived
**REGISTRY-BOUND floor entry** (bound to the REAL SE scenario ids,
measuring the fixture's own declared KPI dimensions, the honest split
disclosed IN the entry) so the REAL DH-09 compose floor is honored —
the curated industry benchmark legs are then evaluated through the
acceptance family's combined-catalog composition (THE BENCHMARK-LEG
REFRESH below).

## THE COMPOSITION-NOT-FORK LAW (this family's first law)

**The industries differ ONLY in data.** The runner constructs its real
kits through ONE code path with the SAME injected seams (clock / rng /
fsPort / root) for every industry — the REAL DH-11 activation journey
kit (one construction per run through the same open path), the REAL
DH-10 projections kit and the REAL DH-12 optimization loop kit (ONE
shared construction each). A fifth industry is a NEW fixture module,
never a code path (pinned: a well-formed `legal` fixture runs green
through the same path in the battery). The census pins the twelve
family contract versions (DH-001..DH-012) IDENTICAL across every
industry's composed records AND equal to the imported family constants;
the module-identity pins (`industriesServed`, the shared kit
constructions, `fixturesArePureData: true`) ride every report. The
battery pins the source law: the runner carries NO industry-string
literal, and the four fixture modules export ONLY frozen data.

## THE FAIL-CLOSED VERDICT LAW (the DH-GAP-2 updated truth)

The overall acceptance verdict is GREEN only when EVERY industry's
journey leg is complete AND every honest gap is REGISTERED. Any refused
leg or any missing gap registration is the TYPED refusal — never a
silent pass, never a partial green. **THE CLOSED-ROW LAW**: the
ledger's closed rows (1-2) ride the report VERBATIM with their closures
recorded IN the rows — and can never be registered as an open gap by a
fixture (the contract walk, the row walk, the runner's gap registration
and the ledger replay all refuse a closed-row registration). **THE
COVERAGE LAW**: a fixture whose industry carries a task-world (the four
lane industries — software through the landed base registry; the three
through the lab industry extension registry) MUST carry the curated
benchmark (the coverage row is closed; an un-exercised evaluable
benchmark leg has no honest registration); a world-less industry
carries the honest null (the `gap-registered` benchmark status, the
registry-bound floor entry composing the DH-09 record). A refused
journey leg fails the whole cross run and no report is emitted over a
refused leg (pinned: the CORRUPT_SEAM budget pin leaves ZERO ledger
lines and NO report file).

## The honest gap ledger (the six frozen rows, carried VERBATIM in every report; rows 1-2 CLOSED)

| # | gapKey | description | evidence level | owner |
| --- | --- | --- | --- | --- |
| 1 | `lab-task-worlds-coverage` | CLOSED 2026-10-15: the three industry task-worlds (finance/healthcare/construction) landed at PR #205 in the lab extension registry; the SE world plus three industry worlds - all four acceptance-lane industries carry industry-specific simulation worlds and their benchmark legs are bound; the coverage row is closed, recorded in the row (never by silent removal) | `fixture` | TL-B (the Lab lane) |
| 2 | `content-representativeness` | CLOSED 2026-10-16: the four industry content sets are deepened to the declared censused representativeness bar - each industry carries at least six roles, ten terms, four tasks, four bodies, four packs and two profiles of real domain-shaped curated content (the census pinned by the battery, the content-census disclosure riding every report); the fixture-level bound stays disclosed - curated acceptance content, never a domain-truth claim; the row is closed, recorded in the row (never by silent removal) | `fixture` | TL-B (the harness acceptance family) |
| 3 | `no-live-provider-execution` | no live-provider exchange is exercised here (tracked at the INF boundary: the INF-009 canary env-gated skip) | `fixture` | INF lane (the INF-009 canary) |
| 4 | `no-production-real-harness-deployment` | the harness families' evidence ceiling is fixture/simulated; production deployment of harness configurations is a future TL-A-coordinated step | `fixture` | TL-A (the production lane) |
| 5 | `workbench-surface-runtime-binding` | the flauz-harness extension's runtime binding is covered by the bundle+activation gates (the flauz-lab law), not the node lane; the UI behavior is verified here at the projection-derivation level + the extension's own node suites | `fixture` | TL-B (the workbench surface family) |
| 6 | `cr-ledger-integration-gaps` | the Phase C-R terminal ledger's three exercised-but-unresolved and two unexercised integration gaps remain tracked in the CR records (cross-referenced, not re-litigated here) | `fixture` | station (the Phase C-R ledger) |

The instrument never closes these rows by passing a test — the report
carries them so a green verdict can never be read as a claim the ledger
refutes. The unproven is REGISTERED, never promoted. A row whose owning
lane landed its closure carries its CLOSED successor state — the
closure recorded IN the row, never by silent removal (THE FROZEN-LEDGER
LAW, the DH-GAP-2 wave's own subject) — and the closed rows are
registered by NO fixture (rows 3-6 remain the open registered residue).

## THE CONTENT DISCLOSURE + THE CONTENT CENSUS

The four industry content sets are **CURATED FIXTURE-LEVEL acceptance
content** — representative, honestly labeled at the **DECLARED CENSUSED
REPRESENTATIVENESS BAR**: each industry carries at least **six roles,
ten terms, four tasks, four bodies, four packs and two profiles** of
real domain-shaped curated content (the census pinned by the battery;
the content-census disclosure riding every report). NOT a claim of
comprehensive domain truth, NOT promoted evidence — the fixture-level
bound stays disclosed.

## The evidence disclosure (the fixture/simulated ceiling)

The task execution evidence is the **LAB closedLoop fixture execution**
over the real deterministic instances (the landed closed-loop engine
drives the base-registry SE scenario for every benchmark leg — the
honest limitation disclosed in the execution disclosure) plus the
**real authority routing** (the DH-01 lifecycle at `active` through the
real transitions, re-read at the authority's own ledger; the benchmark
legs evaluated through the REAL DH-09 surfaces for the base-registry
binding and through the acceptance family's combined-catalog
composition over the REAL imported lab extension registry lookups for
the industry-extension bindings) — honestly labeled at the
fixture/simulated ceiling. Never a live-provider exchange, never a
production deployment. The DH-12 optimization smoke leg runs observe →
simulate → compare → recommend through the REAL loop kit over the
combined-catalog-derived activity corpus and pins the auditable
recommendation (the uncertainty / missing-capability / reversibility
disclosures present, the evidence level at or below the loop's frozen
`simulated` ceiling).

## THE BENCHMARK-LEG REFRESH (the DH-GAP-2 wave)

The runner's benchmark leg composes over the fixture's declared binding
mode — data-driven, never an industry branch:

- **the base-registry binding**: the REAL DH-09 kit surfaces end-to-end
  (`instantiateBenchmark` seeded and reproducible over the composed
  record + `evaluateBenchmark` over the runner-derived honest measures)
  + the REAL LAB `runClosedLoop` (the ten-stage fixture execution).
- **the industry-extension binding** (the disclosed contract addition):
  the instances generated by the REAL imported `generateTaskInstances`
  (the lab industry extension registry's own engine entry point) into
  the REAL DH-09 bundle shape; the same honest fixture-measure
  derivation; the evaluation record composed in the REAL DH-09 result
  shape, bound to the journey's own benchmarks record and harness (the
  DH-09 evaluation surface is record-bound — a landed law — so the
  family composes the record over the imported machinery; never a
  forced entry into the landed base-registry-bound record) + the REAL
  LAB `runClosedLoop`.

## The run map (every leg through the REAL kits)

| leg | drives | verdict dimension |
| --- | --- | --- |
| the DH-11 journey | the REAL activation journey kit — `beginJourney → selectIndustry → composeCompany → selectWorkTypes → composeRoles → composeRecords (the six REAL record kits) → proposeHarness → approveHarness → activateHarness`, with the catalog snapshot constructed from the fixtures' permissionRefs at approved/enabled states and wired with the runtime-minted record links at the proposal boundary (THE CATALOG-BINDING LAW) | `journey`, `roleComposition`, `workflows`, `policies`, `evidence`, `approvals`, `taskExecution` (the authority pins) |
| the read phase | every composed record READ through its OWNING family's own load + inspect surfaces (THE EVIDENCE-NOT-AUTHORITY LAW); the REAL DH-01 authority re-opened for both the binding root and the final record | the census input (the twelve family versions) |
| the DH-10 projection | the REAL projections kit — `projectNavigation` over the composed records, anchored on the binding composition root | `uiBehavior` (populated / not-composed per section) |
| the DH-09 benchmark leg (both binding modes) | software: the REAL benchmarks kit — `instantiateBenchmark` + `evaluateBenchmark` over the runner-derived fixture measures (only the declared KPIs); the three industry fixtures: the combined-catalog composition — `generateTaskInstances` (the REAL imported engine entry point) into the REAL DH-09 bundle shape + the composed evaluation record; both close with the REAL LAB `runClosedLoop` (the ten-stage fixture execution) | `taskExecution` (the closedLoop executions, the honest scores), `benchmarkStatus: evaluated` |
| the DH-12 smoke | the ONE shared REAL optimization loop kit — observe → simulate → compare → recommend, the auditable recommendation pinned | (the smoke leg's laws; its evidence rides the loop record) |
| the terminal walk | the census → the gap registration → the overall verdict → the canonical report emission | `compositionCensus`, `gapLedger`, `overallVerdict` |

## The persistence mirror (the family's OWN evidence mirror only)

The same `.flauz/harness` subtree, distinct files: the append-only ops
ledger `.flauz/harness/acceptance-ops.jsonl` (one canonical JSON line
per applied op; the frozen eight-key line schema; the seq strictly
increasing, equal to the line number), the envelope
`.flauz/harness/acceptance-runs.json` (the replay-built run state,
cross-checked byte-for-byte) and the canonical report
`.flauz/harness/acceptance-report.json` (the CR-013 emission pattern).
The ledger is authoritative: the replay re-proves the acceptance laws
FROM THE LEDGER ALONE (the line schema, the op order, the
unique-industry law, the payload walks, THE CLOSED-ROW LAW, the census
identity); a torn or tampered line is the typed
`E_LEDGER_TORN`; a divergent or missing envelope is the typed
`E_ENVELOPE_MISMATCH` — never silently rebuilt. The terminal walk is
RESUMABLE (each stage guarded by its own committed state slot — a
refusal between terminal lines heals by re-running only the un-landed
stages); a re-run over a COMPLETE run re-emits the identical bytes
WITHOUT appending (the idempotent re-read); restart-deterministic.

## The typed refusal vocabulary (the kit layer)

`disposed`, `malformed-fixture` (the contract's typed rejection table
carried verbatim), `industry-already-run`, `journey-refused` (the REAL
DH-11 kit's refusal carried COMPLETE — fail-closed, the whole verdict
refuses with it), `record-read-refused` (a REAL family load/inspect
surface's refusal carried verbatim), `navigation-refused` (the REAL
DH-10 projection's complete rejection table),
`benchmark-leg-refused` (the REAL DH-09 read surface's refusal),
`closed-loop-refused` (the REAL LAB closedLoop's honest undefined),
`optimization-refused` (the REAL DH-12 loop kit's refusal),
`gap-registration-missing`, `census-divergence` (the no-fork census is
breached), `invalid-report`, `E_LEDGER_TORN`, `E_ENVELOPE_MISMATCH`,
`ACCEPTANCE_IO`, `CORRUPT_SEAM`.

## Run commands (from the worktree root)

```sh
~/toolchain/node_modules/.bin/tsc -p build/flauz/harness/acceptance/tsconfig.json --noEmit
bunx --bun mocha --ui tdd 'build/flauz/harness/acceptance/test/common/*.test.ts'
```

### Receipt table

| gate | expected |
| --- | --- |
| `tsc --noEmit` | exit 0 |
| `acceptanceContract.test.ts` | 66 passing, 0 failing |
| `acceptanceRunner.test.ts` | 95 passing, 0 failing |
| the determinism greps over `common/*.ts` + `industries/*.ts` | law-comment lines only |

### Battery map

| suite | pins |
| --- | --- |
| the contract battery (66) | the version cross-pins (this family + the TWELVE prior family versions + the REAL `LAB_CONTRACTS_VERSION`), the frozen lane, the six-row honest gap ledger (verbatim + frozen; rows 1-2 CLOSED with their closure records; THE CLOSED-ROW LAW's closed-key list), the curated-fixture walk (the four shipped fixtures green; every REAL vocabulary station; THE INTERNAL-REF LAW; the censused bar; THE BINDING-MODE LAW — the base-registry walk, the industry-extension walk with THE TWO-PHASE BINDING LAW + the combined-catalog scenario binding + THE INDUSTRY-MATCH LAW; THE COVERAGE LAW; THE CLOSED-ROW LAW; every fail-closed station typed), THE CONTENT CENSUS (the per-industry depth pins by name), the industry-row walk, the report walk + the canonical serialization + the fail-closed parse, the determinism greps |
| the runner battery (95) | the fail-closed factory, THE CROSS-INDUSTRY CROWN (the four industries journey-complete through the REAL kits, the DH-01 authority re-read at `active`, the per-leg verdicts, the four evaluated benchmark legs with the deterministic measures over both binding lanes, the census identity, the closed-row gap registration, the report emission + re-parse + byte-stability + restart determinism), the per-industry op surface (the unique-industry law, the fifth-industry pin with the floor entry, the malformed-fixture pins incl. THE COVERAGE LAW, the dispose law, the fresh-kit guard), THE FAIL-CLOSED PINS (the CORRUPT_SEAM budget pin, the real load-surface refusals carried verbatim, the census-divergence pin), THE COMPOSITION-NOT-FORK source pins, THE INDUSTRY BENCHMARK LEGS + THE CLOSED-ROW LAWS (the binding-mode composition at the ops surface, the honest split at the DH-09/DH-12 surfaces, the combined-catalog corpus, the emitted closure records, the closed-row replay station, the register-gaps lane law), THE PERSISTENCE MIRROR (the line schema, the op order, the payload walks, the envelope cross-check, restart determinism at two points, the resumable terminal walk, the IO refusals, every torn/tampered station), the determinism greps |
