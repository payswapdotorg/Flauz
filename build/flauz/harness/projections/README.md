# DH-010 · the domain UI/navigation projections family (`build/flauz/harness/projections/`)

SPEC-first charter (registry row DH-010, "domain UI/navigation
projections"; ARCHITECTURE-LOCK 12.5: a harness may compose
"UI/navigation projections" — a harness over the universal Flauz
core, never a fork; ARCHITECTURE-LOCK 4: the preferred placement is a
built-in Flauz extension consuming a pure derivation layer, never a
core fork). A harness is domain-specific through its industry label
(DH-01), its onboarding record (DH-02), its named roles (DH-03), its
domain terms (DH-04), its task/workflow templates (DH-05), its
organization's default agent bodies (DH-06), its default capability
packs (DH-07), its policy/approval/evidence/KPI profiles (DH-08) and
its benchmark/simulation worlds (DH-09) — and through its
**navigation model**: the frozen section list (`overview, roles,
workflows, capabilities, policies, evidence, kpis, benchmarks,
lifecycle`) the user-facing Flauz surfaces render. This family is the
**PROJECTION layer** for that model: typed, total, deterministic,
fail-closed derivation over CALLER-SUPPLIED composed records, with
the family's validation, serialization and parse laws.

## THE PROJECTION LAW (this family's charter)

Projections are **derived read-only view models computed from
caller-supplied composed records**. The family:

- **never mutates a record** — every input is walked read-only; the
  derived rows are fresh values (the battery proves the
  record-unchanged law);
- **never persists state** — no ledger, no envelope, no journal, no
  second persistence authority (ARCHITECTURE-LOCK 12.6); the
  navigation model is a transport value between surfaces, and its
  canonical bytes are the serialization of a derived value, never a
  persisted record;
- **never becomes an authority** — no permission, approval,
  evidence, KPI, lifecycle or execution authority is granted,
  brokered or led here; applying/activating stays routed through the
  DH-01 authority (the closed door the consuming surface must
  disclose).

**THE ZERO-SEAM LAW**: projections are pure derivation — the kit
accepts NO clock, NO rng, NO fs port, NO root and NO injected
vocabulary of any kind. The construction options object is the EMPTY
record; any key is the factory TypeError naming the seam and the law
(a projection that read a clock, minted an id or touched a file
would stop being a projection).

## THE IMPORT LAW

The record shapes and versions are IMPORTED from the real family
contracts — the DH-01 `DomainHarnessDescriptor` / `HarnessRole` /
`HarnessRecord` / lifecycle-state vocabulary, the DH-02 onboarding
session record, and the roles / ontology / templates / bodies /
packs / profiles / benchmarks record interfaces — never re-declared,
re-implemented or shadowed. The per-family record validation is the
REAL families' own deep validators (`isHarnessRecord`,
`isOnboardingSessionRecord`, `isRoleCompositionSession`,
`isOntologyRecord`, `isWorkflowTemplateRecord`,
`isOrganizationDefaultsRecord`, `isCapabilityPacksRecord`,
`isProfilesRecord`, `isBenchmarksRecord`) — imported by reference and
called; a second record walk is forbidden here. The NINE landed
family versions (DH-01..DH-09) are re-carried BY REFERENCE and the
battery pins every copy equal; `PROJECTIONS_CONTRACTS_VERSION` is
`'1.0.0'`, declared ONCE.

## THE CONTENT LAW (this wave's honesty)

**No per-industry UI content is shipped.** This family is the
DERIVATION layer, not a content layer: the labels are the caller's
record values (the harnessId, the industry, the roleKey, the
profileKey, the term, the taskKey, the packKey, the permissionRef,
the benchmarkKey, the state names); the details are derived
structural sentences; the badges are typed markers derived from the
REAL record states. The caller composes the content; this family
never invents it.

## The projection laws

- **THE ANCHOR LAW** — the DH-01 harness record is the projection's
  ANCHOR: the navigation model is the projection of ONE harness. The
  `harness` slot is REQUIRED; its absence is the typed
  `missing-record` rejection naming the domain-harness family (never
  a silent empty model).
- **THE ABSENT-FAMILY LAW** — the eight optional family slots carry
  record arrays; `undefined` (the key absent) is the ONE honest
  absent marker: the family has no records composed yet and the
  section carries the honest `not-composed` state, never a refusal.
  A PRESENT value (anything other than `undefined`, including null)
  that is not the family's valid records is the typed
  `malformed-record` rejection naming the family — never a silent
  skip, never a silent normalization.
- **THE BINDING LAW** — a family record that carries a harnessId
  binding must bind to the ANCHOR's harnessId or the typed
  `foreign-record` rejection names it. The DH-02 session's nullable
  harnessId is a pre-proposal session — checked only when non-null;
  the DH-03 roles session carries no harnessId (the caller's wiring
  binds it) — never checked.
- **THE DUPLICATE-RECORD LAW** — repeated record ids within one
  family slot are the typed `duplicate-record` rejection (the
  derived rowKeys are unique per record id; a repeat is refused at
  the boundary, never rendered).
- **THE SECTION-SOURCE MAP** (frozen) — `overview` ← the DH-01
  record (industry, workTypes, displayName, lifecycle state) + the
  DH-02 session records (the selection state); `roles` ← the DH-01
  descriptor's roles (the anchor floor — always present) + the DH-03
  records; `workflows` ← the DH-05 template records + the DH-04 term
  records; `capabilities` ← the DH-07 pack records + the DH-06 body
  records + the DH-08 permission legs (the distinct permissionRefs
  across the profiles); `policies` ← the DH-08 records
  (permissionRefs/approvalTiers); `evidence` ← the DH-08
  evidenceFloor legs; `kpis` ← the DH-08 kpiDimensions legs;
  `benchmarks` ← the DH-09 records; `lifecycle` ← the DH-01 state
  machine projection (the REAL five-state list + the REAL
  forward-transition whitelist, with derived current/past/upcoming
  and available/consumed/not-reached positions).
- **THE SECTION-STATE LAW** — a section is `composed` iff it carries
  at least one row, `not-composed` otherwise (the honest absence —
  whether the family is absent or composing with zero entries); the
  not-composed section carries NO rows (never fabricated).
- **THE FAIL-CLOSED LAW** — every refusal is a typed record naming
  the violated law and the offending items; multi-offense input
  walks report the COMPLETE rejection table in the frozen six-station
  walk order (`malformed-inputs, unknown-key, missing-record,
  malformed-record, duplicate-record, foreign-record`); never a bare
  throw on a domain refusal.
- **THE CANONICAL SERIALIZATION LAW** — the navigation model
  serializes to canonical fixed-key-order JSON bytes
  (byte-deterministic; double-serialize byte-equality; the sections
  in the frozen section order, the rows in their derived order); the
  fail-closed parse refuses non-canonical bytes (never a silent
  normalization), with its own frozen six-station parse vocabulary.

## The kit

`createProjectionsKit(options?)` — the deterministic derivation kit
(THE ZERO-SEAM LAW above): `projectNavigation` (the delegated
projection walk, every typed refusal carried complete with the
first-rejection reason as the honest label), `serializeNavigationModel`
/ `parseNavigationModel` (the delegated canonical serialization
laws), `listSections` (the frozen section list read), `dispose`
(THE DISPOSE LAW — the kit holds NO domain state; after dispose,
`projectNavigation` rejects with the typed `DISPOSED` refusal and
the pure delegates throw the TypeError naming the law — the
factory-misuse class, never a domain refusal).

## The battery

| suite | file | passing |
| --- | --- | --- |
| projections contract | `test/common/projectionsContract.test.ts` | 122 |
| projections kit | `test/common/projectionsKit.test.ts` | 31 |
| **family total** | `test/common/*.test.ts` | **153** |

The battery includes the version cross-pins (nine family versions +
this family's own), the family-id prefix map pinned against the REAL
contracts' own prefixes, the badge vocabulary derived from the REAL
imported state vocabularies, the projection of the FULLY-composed
harness (the crown input — all families provided, every section
populated), every malformed-input refusal class, the absent-family
honest states, the lifecycle projection over all five REAL DH-01
states, the serialization round-trip with every model-rejection and
parse-rejection class, THE CROSS-KIT CROWN (the REAL DH-01 kit
minting + the full forward lifecycle, the REAL DH-02 walk proposing
the SAME harness id through the shared rng seam, the REAL
DH-03..DH-09 composed records → the complete model → the canonical
round-trip; plus the foreign-record negative and the anchor-alone
absent-family pin), and the determinism greps reading the modules'
own source (law-comment lines only).

Run recipes (the landed family recipe; bun is preinstalled):

```sh
NODE_OPTIONS=--max-old-space-size=2048 <tsc> -p build/flauz/harness/projections/tsconfig.json --noEmit
bunx --bun mocha --ui tdd 'build/flauz/harness/projections/test/common/*.test.ts'
grep -nE "Date\.now|Math\.random|new Date\(|process\.env" build/flauz/harness/projections/common/*.ts   # law-comment lines only
```

Evidence level claimed: fixture-level contract/kit code (the
registry row's class; no env reads, no secrets, no evidence
promotion — the projection layer derives view models only).
