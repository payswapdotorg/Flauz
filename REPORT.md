# CR-009 REPORT — the compound capability commands (B2, Phase C-R wave 5)

Pinned base 0b0ec4321f759d18827c25dfd0182d8c410a5a2c. Branch
flauz-tlb/cr009-compound-commands, one commit. This report is the
honesty register the work order demands: every ruling, every
known-unknown, every deviation — including the v2 audit corrections —
and the full verbatim D-register (Appendix A).

## 1. What was delivered

Three compounds as LIBRARY surface under build/flauz/cli/**, plus a
41-test mocha tdd suite over the real authorities:

- capability.onboard: discover -> register (the registry's own
  digest-over-discovered binding) -> the gate tail
  (submitVerificationReceipt -> decidePermissions -> approve ->
  enable) -> final disclosure (fresh-registry journal truth + the
  gate's own policy summary).
- capability.gate-flow: the gate tail over an existing entry.
- capability.teardown: disable -> remove -> terminal read, with the
  machine's own terminal-state refusals surfaced typed.

Files: build/flauz/cli/runtime/compounds.ts,
build/flauz/cli/compound.test.ts (v2), MANIFEST.txt, REPORT.md (this
file). Additions only — zero grammar, wire, exitcodes, bin, handler,
context, registry, gate, or battery file changes.

The compound is orchestration + a typed error surface ONLY. It owns no
state model, no refusal vocabulary, no clock, no journal, no gate
records, and no permission state. Every mutation routes through the
authorities' public operations; every refusal passes through verbatim
(code, law, entryId, state, detail, source) wrapped with the
completed-steps ledger.

## 2. The D8 arbitration, verbatim (required disclosure)

> D8 ARBITRATION (the station rules — binding): The CR-010b header law
> "the CLI never mutates the registry" is a WAVE-2 SCOPE RULING pinned
> to the capability-discovery handler family (its census line + its
> header). The CR-009 work order — the station's own wave-5 commission
> — SUPERSEDES it for the NEW compound family: the compound handlers
> MAY invoke the registry's and the gate's OWN MUTATING PUBLIC
> OPERATIONS (register / verify / approve / enable / disable / remove
> through the registry's public API; the verify+decide+approve
> sequence through the CR-008 gate's own API). The laws that REMAIN
> BINDING on the compounds: (1) every mutation routes through the
> authority's own public operation — never a side channel, never a
> shadow store, never a re-implementation; (2) the authority's own
> journaling + typed refusals pass through typed (the compound adds
> orchestration + typed error surface only); (3) the D8 supersession
> itself is DISCLOSED verbatim in REPORT.md.

(This arbitration resolved the tension disclosed as D8 in the
session's honesty log; see Appendix A.)

## 3. The frozen-surface rulings (station-final)

### 3a. The grammar ruling: FINAL NO

The work order conditioned grammar rows on the grammar's own amendment
law permitting them. No amendment law exists. grammar.ts freezes the
29-command table ("pinned by tests"), and wire.ts doubly locks it:
'unknown-journey' rejects any path outside the eight service journeys,
and the CLI refusal table is closed ("adding a refusal is a contract
change requiring a version bump"). The station ruled: "Your byte-based
ruling GOVERNS... keep the fail-closed provisional-NO and deliver the
compounds as runtime modules + tests with the ruling disclosed," and
station-final: "Your grammar FINAL-NO ruling STANDS (fail-closed; no
frozen-table rows added)." Consequence: zero grammar rows, zero bin
dispatch, zero wire edits; the compounds are library surface.

### 3b. The battery ruling: J-legs out of scope; the J4/J6 citation

Station-final: "Consequently the battery J-leg upgrades are OUT OF
SCOPE for this delivery — cite the J4/J6 compound-relevance in
REPORT.md as future work (the battery's own amendment path), zero
battery file changes." Zero battery bytes were touched.

The compound-relevance, cited for the future amendment path (the
battery's own honest-statuses law: amendments land through the owning
CRs' waves):

- **J4 (journey-4-capability):** the runnable local-real legs
  (j4-s2-discover, j4-s3-inspect, j4-s4-import, j4-s5-verify,
  j4-s6-approval) run the CR-006 registry's public API directly via
  the battery's runCapabilityPipeline. The onboard compound is
  precisely the ONE-COMMAND composition of that sequence, extended
  through the CR-008 gate tail (receipt -> decision -> approve ->
  enable) — a path the J4 pipeline today does not traverse: it calls
  registry.verify/approve directly with machine-loose receipts, never
  enables, and records no gate permission decision. A future battery
  amendment could run onboardCapability as the J4 composition leg with
  gate-evidenced approval and the enable the compound adds.
- **J6 (journey-6-cli):** the J6 legs exercise grammar commands
  headless (runCli + expectExit). The compounds are unrepresentable
  as CLI commands at contract 1.0.0 (ruling 3a), so no J6 leg can
  exercise them today. The designed future mapping (unbuilt): a
  completed compound projects ok/exit 0; a mid-sequence stop projects
  partial/exit 4 carrying the ledger digest; pre-start refusals
  project typed-refusal/exit 1 — awaiting the grammar/wire amendment
  path (a contract version bump).
- **Adjacent, one line:** journey-7-unsafe-capability's pending
  detect/reject/explain legs (owner CR-008) map naturally onto the
  compounds' typed refusal surface (E_HIGH_RISK_UNACKNOWLEDGED; the
  verification-failed intermediate stop) — same future-work path.

## 4. Design rulings that shaped the bytes (the register)

R1/R30 error surface: registry value-refusals pass as values;
GateError is caught and normalized; TypeError propagates (factory
misuse). R3: the gate's own approve law inserts decide-before-approve
(the work order's verify->approve->enable sketch was corrected by the
gate bytes). R6: no compensation — partial failure stops with the
ledger + verbatim refusal (there is no undo; auto-disable would be the
compound making lifecycle decisions). R23 instance choreography: head
registry, then gate construction (its internal registry replays the
head's writes), then a FRESH registry for the final disclosure —
mandated by the station-ruled laws (load() is first-call-only; live
instances never see other instances' writes; fresh instances see
everything). R35: register binds by digest over discovered entries
(R27 verbatim). R38: gate-strict { checkId, verdict } receipts on the
gate tail; the registry's machine accepts a looser shape — the
divergence is the authorities' own, disclosed in the module header.
R43-prime: the machine is the sole continuation arbiter — the compound
attempts each next step; an unlawful continuation surfaces the
machine's own typed refusal (every registry refusal path returns
before any journal write, so a refused attempt is side-effect-free).
The compound therefore owns ZERO refusal vocabulary. Teardown shape
consequence (byte-ruled): disable is granted only from enabled /
available, so teardown of an approved-only entry honestly refuses at
disable through the machine — asserted by its own test. Determinism
idiom (v2): the battery's own proven law — wipe the registry root and
rerun on the SAME root, comparing outcome objects and journal /
snapshot / gate-records bytes. Cross-root byte-equality is NOT
asserted (see section 5).

## 5. Known-unknowns (byte-undetermined; NOT invented)

- Q11 (station-unanswered): the semantics of a LONE verified-partial
  receipt — whether entry.verification.status reads 'verified' (legal,
  warnable enable with the W census) or 'verified-partial' (the gate's
  defensive E_JOURNAL_UNLAWFUL) — is not determined by any pasted
  bytes, and the single verify edge (granted only from 'imported')
  makes a partial-then-verified history unconstructible. The suite's
  partial-verification leg is therefore DUAL-TOLERANT: it asserts
  whichever verdict the authorities actually produce, proving the
  compound's verbatim pass-through under either ruling. FIRMING THIS
  REQUIRES: the gate.test.ts W-leg test, or a station ruling on the
  receipt sequence and resulting status.
- EntryId derivation was never pasted. The battery proves byte
  determinism for wipe-and-rerun on the SAME root; nothing pasted
  proves two DIFFERENT roots produce identical entryIds or journal
  bytes. The determinism tests therefore use the battery's idiom only
  — cross-root equality is not asserted.
- Project-availability fact semantics (which { platformMatch,
  dependenciesPresent } combination lands 'available' vs
  'unavailable') were never pasted; teardown-from-'available' is
  therefore not exercised. The registry's own suite owns that edge.
- E_REGISTER_REQUIRES_DISCOVERED is byte-known (R27 verbatim) but not
  reachable through the compound's always-discover-first head; it is
  left to the registry's own suite.
- Register selection residual: the exact selection rule among multiple
  discovered entries with the same digest is not byte-confirmed; the
  compound threads nothing between discover and register (the
  authority binds), and the multi-entry test exercises the pasted
  first-matching-discovered scan.
- Post-success disclosure reads (fresh inspect / policySummary) are
  infallible under the journal laws; a refusal there throws plainly
  rather than faking an outcome.
- Date.parse of a non-parseable issuedAtIso would yield NaN clocks —
  mirrored unchanged from the landed bindRegistryRead idiom (caller
  responsibility, disclosed).

## 6. Deviations and disclosures

- D-tools: this delivery was produced without shell/git tools under
  the work order's paste-request protocol. ALL gates are station-run;
  no local-real evidence originates from the author. Station re-runs
  are the truth.
- v2 AUDIT DISCLOSURE: the station re-sent the final input batch
  byte-identically (new trace id). Treated as a re-run trigger, a
  self-audit of the delivered test file found and fixed three defect
  classes: (a) seeds and differential assertions calling registry
  operations on UNLOADED instances — every operation is gated on
  load() (E_NOT_LOADED), so the differentials would have compared
  against the wrong refusal and failed at the station gate; (b) the
  determinism tests asserted cross-root byte-equality, which no pasted
  byte proves — replaced with the battery's wipe-and-rerun idiom; (c)
  a test-count misstatement (39 actual vs 41 claimed), corrected by
  recount plus two added byte-grounded tests (the torn gate-records
  construction refusal; the approved-only teardown differential). The
  module (compounds.ts) survived the audit unchanged; MANIFEST's 41
  is now literally true. The re-run-was-the-truth premise is exactly
  what this audit exercised.
- git diff --stat: not statable by the author (no tools). Expected
  SHAPE: strictly additive — 4 new files
  (build/flauz/cli/runtime/compounds.ts, build/flauz/cli/compound.test.ts,
  MANIFEST.txt, REPORT.md), 0 modified files, 0 deletions; insertion
  counts equal the delivered files' line counts, station-verified at
  the gate.
- Q9 (raised three times, then closed by the station's final delivery
  directive): MANIFEST.txt/REPORT.md at the workspace root per the
  delivery clause's explicit placement — read as the placement
  sanction itself, confirmed by the station's instruction to deliver
  both "at the workspace root."
- The work order's surface-map memory contained two errors, corrected
  by bytes: capability-discovery.inspect is not a grammar path (the
  handler census comment is explicit), and the wire/exitcodes modules
  — which bin/flauz.ts imports authoritatively — were missing from
  the surface map (they were pasted on request).
- Retired during design (never shipped): the compound-owned
  E_COMPOUND_INTERMEDIATE_STATE code and the TRANSITIONS-derived
  continuation pre-check — both superseded by the cleaner
  machine-as-sole-arbiter design (R43-prime), which is strictly more
  faithful to "never a second authority".
- Observed, not changed: wire.ts types CliRefusalResponse.refusalCode
  as CliRefusalCode while exitcodes.ts's sibling copy types it string
  (structurally compatible; frozen modules untouched).

## 7. Evidence labels

local-real: the compound suite runs the REAL registry and REAL gate
over real node fs (per-test mkdtemp roots) with the injected fixed
clock (Date.parse of a plain ISO string — the landed idiom). Nothing
simulated; nothing promoted.

## 8. Test census (recounted in v2)

41 tests / 4 suites: onboarding 16 (happy path, scope law, byte
accounting, clock pins, determinism x2 by the wipe-rerun idiom, digest
mismatch, gate-strict receipt legs x2, high-risk law, acknowledgement
mismatch, malformed decision, the verification-failed intermediate
stop + differential, torn-journal load, TypeError legs, multi-entry
binding); gate-flow 11 (happy, decide-writes-no-line, the
dual-tolerant Q11 leg, high-risk acknowledged, record shapes, unknown
entry, already-verified differential, the torn gate-records
construction refusal, restart replay, determinism, TypeError);
teardown 10 (happy x2, byte accounting, discovered-only differential,
approved-only differential, terminal differential, empty reason,
unknown entry, gate survival, determinism); cross-laws 4 (the
station-ruled live/fresh instance laws, journal-truth disclosure,
census pin, grammar FINAL-NO pin).

## 9. Station gates and expected results

- scoped tsc: node_modules/.bin/tsc -p build/flauz/cli/tsconfig.json —
  EXIT 0 (both delivered .ts files are inside the include; explicit
  .ts/.mjs specifiers throughout).
- mocha tdd cli suite: baseline 56/56 — UNTOUCHED (separate file, no
  shared state; per-test temp roots).
- mocha tdd compound suite: build/flauz/cli/compound.test.ts — expect
  41/41. The one deliberately conditional test is the disclosed Q11
  leg; it asserts the authority's actual verdict either way.
- the journey battery: unchanged at the pinned surface (station-final
  ruling 3b).
- determinism grep: the delivered modules contain no Date.now, no
  Math.random, no new Date( — only Date.parse of the injected ISO
  string (the landed idiom).
- git diff --stat: additions-only shape per section 6.

## 10. Future wire integration seam (design note only)

A future contract version could wire the compounds as CLI rows:
projection documents shaped { kind, steps/ledger, counts, derivation
disclosures } (the handler-family document discipline), projected as
sha256Hex(canonicalJson(document)) over completeness 'full' (completed
compound) or 'partial' (mid-sequence stop, exit 4). Nothing here
precedes that version bump; nothing depends on it.

## Appendix A — the verbatim D-register (D1..D27, as logged in session)

- **D1:** No tools ⇒ all gates (scoped tsc, mocha tdd, determinism
  grep, `git diff --stat`) are station-run. I cannot execute or
  pre-verify any of them; REPORT.md will state this plainly. No
  `local-real` evidence can originate from me — station re-runs are
  the truth.
- **D2:** Branch/commit mechanics (`flauz-tlb/cr009-compound-commands`
  cut at the pinned base, one commit on top) are outside my
  capability — a human with repo access applies the file set. Per the
  additions-only placement law, the station diff should show new files
  under `build/flauz/cli/**` plus, only if the amendment law permits,
  the single grammar-row edit.
- **D3:** No deviations beyond tool-less-ness. Zero bytes read, zero
  code written.
- **D4:** Group A files 1–2 ingested; zero code written; zero seams
  invented — six open seams enumerated.
- **D5:** R1–R8 are locked against Group A bytes only and stay
  revisable when Groups B/C land (handler pattern, grammar amendment
  ruling, battery legs). The R3 work-order-text vs gate-bytes conflict
  is resolved in favor of the bytes and disclosed.
- **D6:** B1's three files ingested whole; rulings R9–R16 locked
  against their bytes; zero code written; zero seams invented.
- **D7:** the work order's surface map omits two modules its own bin
  imports authoritatively — wire.ts (the response/refusal channel)
  and exitcodes.ts (the exit-code/render law). Both added as mandatory
  pastes; the compound surface is unrepresentable without them.
- **D8:** the grammar ruling is disclosed as provisional-NO with a
  fail-closed default (R9), and the CR-010b read-only-law vs CR-009
  mutating-mission tension is disclosed as a supersession requiring
  station confirmation (R10). No other deviations. [Resolved by the
  station's D8 ARBITRATION — section 2, verbatim.]
- **D9:** B+ ingested whole; R9 promoted to FINAL-NO on the wire's
  double lock; R17–R20 locked against wire/exitcodes bytes.
- **D10:** the delivery scope is reduced *by the bytes* — compounds
  as library modules + tests, no grammar/bin/battery edits. Disclosed
  as a byte-driven ruling under the WO's own "if and only if"
  conditional; overturning it requires a contract-version change
  outside CR-009's placement law.
- **D11:** flagged: the WO's `capability-discovery.inspect` claim vs
  the grammar's absent row (pending B2); the MANIFEST/REPORT
  root-placement tension (Q9). Zero code written; zero seams invented.
- **D12:** All station rulings ingested and locked (R21–R26); zero
  code written; zero seams invented; one residue (R27) precisely
  scoped.
- **D13:** Q9 remains unanswered and is re-raised; the default
  (delivery clause, workspace root) is disclosed as an operating
  assumption, not a ruling.
- **D14:** The `git diff --stat` disclosure is declared out of my
  reach (no tools) — the station's re-run remains the truth, per the
  honesty law.
- **D15:** handlers.ts ingested whole; R28–R34 locked against its
  bytes; zero code written; zero seams invented.
- **D16:** D11 resolved by bytes — the WO's
  `capability-discovery.inspect` claim is closed as a work-order
  misstatement, not a repo fact.
- **D17:** Q9 unanswered after two raises; operating under the
  disclosed default. The `git diff --stat` remains station-run (D14).
  No other deviations.
- **D18:** B3 ingested whole; R35–R43 locked against its bytes; zero
  code written; zero seams invented.
- **D19:** two new seams discovered from bytes, converted to scoped
  asks (Q10 import seam; Q11 partial-verification semantics) rather
  than assumptions — the exact failure class the paste protocol exists
  to prevent.
- **D20:** Q9 raised a third time, unanswered; operating under the
  disclosed default. `git diff --stat` remains station-run (D14). No
  other deviations.
- **D21:** All pastes ingested (10 files + 4 station rulings + the
  R27 verbatim ops). The delivery is written exclusively against
  pasted bytes and station rulings; every assertion is either
  verbatim-pasted, imported-from-a-pasted-constant, or differential
  against a live authority call. Zero seams invented.
- **D22:** Q11 is the one station-unanswered seam; it is disclosed
  (REPORT section 5), tested dual-tolerantly, and its firming ask is
  recorded. Q9 closed by disclosed reading (R45). Q10 dissolved by
  design (R43′ — no frozen-table import needed). The
  project-availability edge and E_REGISTER_REQUIRES_DISCOVERED are
  disclosed as untested, byte-known surfaces.
- **D23:** Retirements are disclosed (E_COMPOUND_INTERMEDIATE_STATE
  and the derived-continuation pre-check never shipped; superseded by
  the machine-as-sole-arbiter design). Gates are station-run; the
  diff stat is shape-only. No other deviations.
- **D24:** The incoming message is a byte-identical retransmission of
  the already-consumed final batch (new `trace_id`). It was not
  silently re-run; it was treated as a verification trigger, and the
  delivery was re-audited against the re-pasted authority bytes.
- **D25:** The audit found three real defect classes in the delivered
  test file (unloaded-instance seeds/differentials; cross-root
  determinism resting on an unpasted entryId assumption; a
  test-count misstatement 39→41). All are fixed in the v2
  re-delivery and disclosed in REPORT section 6. Had the station not
  re-run, defects (a) would have surfaced as gate failures — the exact
  scenario the honesty law exists to preempt.
- **D26:** Standing items unchanged: Q11 remains the one
  station-unanswered seam (dual-tolerant test + firming ask
  recorded); all gates remain station-run; the diff stat remains
  shape-only; no seams invented.
- **D27:** The station's final directive (all seams closed; deliver
  now) is honored with the consolidated final set: File 1 re-emitted
  byte-faithful to the audited v1; File 3 updated to v2
  (census-aligned, station-final rulings recorded); Files 2 (v2 test
  suite) and 4 (REPORT v3, adding the mandated J4/J6 future-work
  citation and the verbatim D-register) follow on `continue` per the
  continuation protocol. Zero grammar/battery edits; all gates remain
  station-run; the diff-stat shape remains additions-only (4 new
  files); no seams invented.
