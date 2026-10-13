# DH-003 roles family

The typed multi-role user composition instrument for the Domain Harness
OS direction (WORK-REGISTRY.md § TL-B, item 3/13): the frozen
per-industry role-template catalogs (exactly one per frozen DH-01
industry; roleKey + summary ONLY — a named role is configuration and
grants NOTHING), the frozen per-work-type role-key affinity map (the
cross-industry suggestion vocabulary), the deterministic composition
selection (the affinity union intersected with the industry's catalog,
in the catalog's own order, deduplicated, with per-role provenance),
and the explicit multi-role selection validation against the industry's
catalog. A harness is **composable configuration over the universal
Flauz core, NOT an industry-specific fork** — the roles family is a
PURE, STATELESS instrument over the landed DH-01 contract layer; role
invention was deferred from the DH-002 review stage to THIS family, and
this family is that item. Role/ontology TERMINOLOGY is DH-004's item;
capability POPULATION is DH-007's; the onboarding session machine and
its persistence belong to the DH-002 family, never this one's.

## 1. The SPEC (the design record)

### The surface inventory

```
build/flauz/harness/roles/
  common/
    rolesContract.ts        the pure contract module (no fs, no clock calls, no kit):
                            the DH-01 vocabularies imported and re-exported BY
                            REFERENCE (16 industries / 10 work types, never
                            re-declared), the frozen per-industry role-template
                            catalogs (16 x 4-8 domain-honest templates, the DH-01
                            { roleKey, summary } shape, shared vocabulary across
                            industries), the frozen per-work-type affinity map (10
                            non-empty ordered key lists, every key resolving in at
                            least one catalog), the role-key law (^[a-z]+$ single
                            lowercase word) and the 200-char summary bound, the
                            frozen rejection vocabulary (16) and parse vocabulary
                            (5), the template / catalog / affinity / request /
                            selection / record walks (first-failure in the frozen
                            walk order), the canonical fixed-key-order
                            serialization, the fail-closed parse
    rolesKit.ts             the deterministic composition kit over the contract
                            vocabulary: createRolesKit (fail-closed factory; the
                            injected clock is the ONLY seam - no rng, no fs, no
                            catalog seam: the stateless design is deliberate and
                            disclosed), suggestComposition (THE COMPOSITION LAW
                            engine), validateSelection, inspectCatalog (the frozen
                            catalogs BY REFERENCE), dispose; all ops async with
                            typed outcomes, kit refusal extras disposed +
                            corrupt-seam
  test/
    common/
      rolesContract.test.ts   the contract battery (94 tests)
      rolesKit.test.ts        the kit battery (35 tests, incl. the four
                              INTEGRATION LAW tests through a REAL DH-002
                              onboarding kit - which constructs the REAL DH-001
                              harness kit - over a REAL mkdtemp temp root)
  tsconfig.json             byte-parity with build/flauz/harness/contract/tsconfig.json
  README.md                 this file
```

### The refusal taxonomy

Every domain refusal is the typed record
`{ ok: false, refusal: { reason, law, message, items? } }` — never a
string throw, never a silent skip, never a partial effect. The
contract's frozen list `ROLES_VALIDATION_REJECTION_REASONS` (16, the
exact walk order):

```
malformed-record, no-fork, unknown-key, missing-key, unknown-industry,
empty-work-types, unknown-work-type, duplicate-work-types,
work-types-out-of-order, role-not-in-catalog, duplicate-role-keys,
unknown-affinity-role, empty-composition, invalid-role-key,
invalid-summary, version-mismatch
```

The walks are **first-failure-is-the-verdict** in this order:
`malformed-record` (not a plain object, or a PRESENT field/carrier
carries the wrong structural type — an absent key is the `missing-key`
station), `no-fork` (the DH-01 forbidden-key family on the record, and
ANY extra key on a role template — the DH-01 station (c), fired BEFORE
`unknown-key` per the precedence law), `unknown-key` (the strict-schema
engine at the record / request / provenance level), `missing-key`, then
the field stations (`unknown-industry`, the work-type subset laws in
the DH-01 frozen order, `role-not-in-catalog`, `duplicate-role-keys`,
`empty-composition`, `invalid-role-key`, `invalid-summary`), the
provenance parallel laws (a torn parallel structure is
`malformed-record`; the `contributedBy` work-type subset laws re-fire
the work-type reasons), and `version-mismatch` LAST (a record with both
an unknown industry and a wrong version reports `unknown-industry`).
The kit layer completes the taxonomy with the frozen extras `disposed`
and `corrupt-seam` (`ROLES_KIT_REFUSAL_REASONS` = the 16 + the 2); the
kit surfaces the contract walks' refusals **verbatim**
(field-for-field, battery-pinned against the direct contract walk).

### The composition algorithm (THE COMPOSITION LAW)

`suggestComposition({ industry, workTypes })`:

1. The request walk (the frozen vocabularies, imported by reference
   from the DH-01 contract): `unknown-industry`, then the work-type
   subset laws (`empty-work-types`, `unknown-work-type`,
   `duplicate-work-types`, `work-types-out-of-order` — the frozen list
   order preserved).
2. The resolution: the union of the requested work-type affinities,
   **intersected with the industry's catalog** (affinity keys absent
   from this industry's catalog belong to other industries'
   vocabularies — the intersection is the composition rule, NEVER a
   silent skip; the integrity walk guarantees every affinity key
   resolves in at least ONE catalog).
3. The ordering: the industry catalog's own order (never the affinity
   order, never the request order), deduplicated; each entry carries
   its provenance (the contributing work types, in the frozen list
   order) in the **parallel** provenance array.
4. The empty guard: an empty intersection is the typed
   `empty-composition` refusal — the honest refusal, never a silent
   empty success (live case: construction + `analysis`).
5. The stamp: the injected clock's reading, carried verbatim into
   `composedAtIso` (the kit never reads a clock itself); the record
   carries the contract version, the industry, the request echo, the
   roles and the provenance — canonical fixed-key-order bytes.

`validateSelection({ industry, roleKeys })`: every roleKey must be a
member of the industry's catalog (`role-not-in-catalog` listing every
offender — a shared-vocabulary key from ANOTHER industry is not a
member of THIS catalog), no duplicates (`duplicate-role-keys`, the
inherited law), non-empty (`empty-composition`); the ok result carries
the resolved templates **in catalog order**.

### The catalog design (the SPEC refinement)

16 catalogs, 4-8 domain-honest templates each (the battery pins them
byte-exact): software carries architect / implementer / reviewer /
tester / analyst / writer / coordinator / auditor; legal carries
counsel / paralegal / drafter / reviewer / researcher / writer /
negotiator / analyst; and so on across finance, healthcare, education,
marketing, science, media, construction, logistics, retail,
manufacturing, energy, agriculture, government, hospitality. The
**shared vocabulary** is real: `reviewer` sits in exactly the seven
pinned industries (software, legal, finance, marketing, science, media,
government), and the same key means domain-specific work in each (the
summaries are per-catalog). The 10 affinity lists are ordered by
affinity strength and cross industry boundaries (e.g. `planning` names
planner, architect, strategist, supervisor, counsel, administrator,
producer); catalog-only templates that sit in no affinity (e.g.
software's `tester`) are selectable but never suggested. Every industry
composes for at least one work type (battery-pinned); ill-fitting
combos compose the typed `empty-composition` refusal.

### The stateless design (deliberate and disclosed)

The kit takes ONLY the injected clock: no rng (the kit mints no ids),
no fsPort / root (the DH-002 onboarding session owns persistence — the
composition record is an honest value, persisted by whoever consumes
it), no catalog seam (the catalogs are the frozen contract
configuration, imported by reference — never injectable, never a copy:
`inspectCatalog` returns the frozen binding itself, and the battery
pins referential identity for all 16). The mid-op clock guard is the
typed `corrupt-seam` refusal (the landed families' injected-seam
discipline: an honest timestamp or none at all).

### THE INTEGRATION LAW (battery-pinned through a REAL kit)

The composition record's `roles` array is the DH-01 role shape
(`{ roleKey, summary }` — the provenance lives in the parallel array
and NEVER leaks into the roles entries), and is **directly admissible
as the DH-002 review stage's `composeDraft` roles input**. The battery
pins it end-to-end: a REAL `createOnboardingKit` (which internally
constructs the REAL DH-001 harness kit) over a REAL `mkdtemp` temp root
with a REAL node:fs-backed port — `beginSession → selectIndustry →
composeCompany → selectWorkTypes → composeDraft({ roles:
suggestion.roles, ... })` mints the harness draft on real disk (the
mint line's `descriptor.roles` deep-equal the composition roles,
read back from the harness ledger), and `proposeSession` walks the
session to `proposed` through the real NO-DANGLING-REF boundary. The
validated selection's resolved templates compose through the same
boundary (battery-pinned).

## The binding laws (inherited from the DH-001/DH-002 landed families)

1. **THE NO-FORK LAW** — a role template is roleKey + summary ONLY;
   any additional key is the typed `no-fork` rejection (the DH-01
   station (c), fired before `unknown-key`); the forbidden-key family
   (imported by reference) never appears on any record; a named role
   is CONFIGURATION and grants NOTHING by itself; the catalogs carry
   zero execution material.

2. **THE FROZEN-CATALOG LAW** — the 16 catalogs + the 10 affinities
   are frozen at this family (bound by DH-004+); membership is the
   only admissibility: a suggested or selected role is ALWAYS a member
   of the industry's catalog; an affinity key resolving in NO catalog
   is the typed `unknown-affinity-role` rejection (a malformed
   catalogs argument resolves nothing — fail-closed).

3. **THE REAL-VOCABULARY LAW** — the industries and the work types are
   imported from the DH-01 contract BY REFERENCE (the same bindings,
   re-exported, never re-declared — the battery pins referential
   identity); the role shape is the DH-01 role shape (`HarnessRole`).

4. **THE DETERMINISM LAW** — no `Math.random`, no `Date.now`, no
   `new Date(...)`, no `process.env` in the shipped modules (law
   comments excepted; the battery greps pin this). The clock is the
   only injected seam, carried verbatim; the serialization is
   canonical fixed-key-order bytes (the DH-01 algorithm: the frozen
   per-shape key orders applied deeply, never an alphabetic re-sort);
   same inputs → byte-identical output (pinned across two
   independently constructed kits).

5. **THE FAIL-CLOSED LAW** — factory misuse throws `TypeError` (the
   DH-01 factory's exact message shapes, the `createRolesKit` prefix);
   every domain refusal is the typed record naming the violated law
   and the offending items; no silent partial effects (a refused op
   composes nothing); every walk is first-failure-is-the-verdict in
   the frozen walk order.

6. **THE SINGLE-VERSION LAW** — `ROLES_CONTRACTS_VERSION` is `'1.0.0'`
   declared ONCE in the contract module, re-carried by the kit (the
   re-export); the battery pins both copies equal.

7. **THE INTEGRATION LAW** — the suggested/validated composition's
   `roles` array is directly admissible as the DH-002 review stage's
   `composeDraft` roles input (battery-pinned through a REAL
   onboarding kit mint in a real temp root; the mint's descriptor
   roles are read back from the harness ledger on disk).

## The frozen vocabularies

- `ROLES_CONTRACTS_VERSION = '1.0.0'`
- `ROLE_SUMMARY_MAX_CHARS = 200`; the roleKey law: `/^[a-z]+$/`
  (a non-empty lowercase hyphen-free single-word kebab identifier)
- `INDUSTRY_ROLE_CATALOGS`: one entry per frozen `HARNESS_INDUSTRIES`
  member (16), each 4-8 `{ roleKey, summary }` templates, unique
  roleKeys, byte-exact pinned by the battery
- `WORK_TYPE_ROLE_AFFINITIES`: one entry per frozen
  `HARNESS_WORK_TYPES` member (10), each a non-empty ordered
  duplicate-free key list, every key resolving in ≥1 catalog
  (byte-exact pinned)
- `ROLE_COMPOSITION_SCHEMA_KEYS` (6): `contractVersion, industry,
  workTypes, composedAtIso, roles, provenance`
- `ROLE_PROVENANCE_SCHEMA_KEYS` (2): `roleKey, contributedBy`
- `ROLES_VALIDATION_REJECTION_REASONS` (16): the refusal taxonomy
  above
- `ROLES_PARSE_REJECTION_REASONS` (5): `malformed-json,
  torn-envelope, unknown-contract-version, unknown-key,
  invalid-record`
- `ROLES_KIT_EXTRA_REFUSAL_REASONS` (2): `disposed, corrupt-seam`
- The DH-01 vocabularies (`HARNESS_INDUSTRIES` 16,
  `HARNESS_WORK_TYPES` 10, `FORBIDDEN_HARNESS_DESCRIPTOR_KEYS` 10,
  their predicates) — imported and re-exported by reference, never
  re-declared

## The battery

| receipt | command | expected |
|---|---|---|
| roles battery (contract) | `bunx --bun mocha --ui tdd 'build/flauz/harness/roles/test/common/rolesContract.test.ts'` | 94 passing, 0 failing |
| roles battery (kit) | `bunx --bun mocha --ui tdd 'build/flauz/harness/roles/test/common/rolesKit.test.ts'` | 35 passing, 0 failing |
| roles battery (full) | `bunx --bun mocha --ui tdd 'build/flauz/harness/roles/test/common/*.test.ts'` | 129 passing, 0 failing |
| type check | `npx tsc -p build/flauz/harness/roles` | EXIT 0 (noEmit in the tsconfig) |
| determinism greps | `grep -nE 'Date\.now\|new Date\|Math\.random\|process\.env' build/flauz/harness/roles/common/*.ts build/flauz/harness/roles/test/common/*.ts` | law-comment lines only (the shipped modules quote the ban in their law comments; the test sources assemble the patterns piecewise and carry zero hits) |
| tsconfig parity | `diff build/flauz/harness/contract/tsconfig.json build/flauz/harness/roles/tsconfig.json` | identical |
| sibling regression (contract) | `bunx --bun mocha --ui tdd 'build/flauz/harness/contract/test/common/*.test.ts'` | 181 passing, 0 failing |
| sibling regression (onboarding) | `bunx --bun mocha --ui tdd 'build/flauz/harness/onboarding/test/common/*.test.ts'` | 158 passing, 0 failing |
| sibling regression (ops) | `bunx --bun mocha --ui tdd 'build/flauz/production/ops/test/common/*.test.ts'` | 137 passing, 0 failing |
