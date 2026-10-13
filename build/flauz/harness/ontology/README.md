# DH-004 domain ontology/terminology family

The typed per-industry terminology layer for the Domain Harness OS
direction (WORK-REGISTRY.md, the wave-4 ontology family, registry row
DH-004 "domain ontology/terminology layer"): the frozen
reference-only term catalogs and relation registries over the REAL
frozen DH-01 industry list (imported by reference, never re-declared —
**THE REAL-VOCABULARY LAW**, this family's charter), plus the
deterministic terminology instrument — the term lookup, the term-set
validation and the relation-graph integrity checks. This family gives
a harness its domain VOCABULARY — the shared language the roles'
summaries and the workflows speak — as pure configuration over the
frozen industry list. A term is CONFIGURATION (a termKey plus a human
definition); it grants NOTHING by itself.

The layer is harness-ADJACENT, not harness-internal: the DH-01
descriptor's alphabet stays the frozen ten keys — **terms are NOT a
descriptor key** — and this family touches no descriptor schema (the
scope boundary; both batteries pin the real DH-01
HARNESS_DESCRIPTOR_SCHEMA_KEYS at ten keys, no `terms` member).

## 1. The SPEC (the design record)

### The surface inventory

```
build/flauz/harness/ontology/
  common/
    ontologyContract.ts   the pure contract module (no fs, no clock calls, no kit):
                          the frozen term shape ({ termKey, definition } ONLY - the
                          NO-FORK discipline), the kebab-case termKey alphabet (<=64),
                          the definition law (<=300, no control characters), the frozen
                          four-class relation vocabulary + the reciprocity table, the
                          sixteen frozen INDUSTRY_TERM_CATALOGS (6-14 terms each) and
                          INDUSTRY_TERM_RELATIONS (2-6 relations each), the sixteen-
                          station validation walk in the exact WO order, the integrity
                          walk machine (walkRelationIntegrity), the canonical fixed-key-
                          order serialization + the fail-closed parse, ONTOLOGY_CONTRACTS_
                          VERSION '1.0.0'
    ontologyKit.ts        the deterministic terminology kit: createOntologyKit over the
                          ONE injected seam (the clock); lookupTerm / validateTermSet /
                          inspectCatalog / relationIntegrityReport / dispose, all async
                          with typed outcomes; THE STATELESS DESIGN (no rng, no fsPort,
                          no sessions, no ledger - persistence belongs to the session
                          families)
  test/
    common/
      ontologyContract.test.ts   the contract battery (98 tests)
      ontologyKit.test.ts        the kit battery (47 tests)
  tsconfig.json      byte-parity with build/flauz/harness/contract/tsconfig.json
  README.md          this file
```

### The term shape

A `DomainTerm` is `{ termKey, definition }` — exactly two keys. The
termKey is a non-empty kebab-case identifier of at most 64 characters
(`^[a-z0-9]+(?:-[a-z0-9]+)*$`: lowercase alphanumeric segments joined
by single hyphens — no padding, no doubling, no underscores, no
uppercase, no control characters), unique within its catalog. The
definition is a non-empty human string of at most 300 characters with
no control characters (C0/DEL/C1). ANY additional key is the typed
`no-fork` rejection — the inherited DH-01 station; a term grants
NOTHING by itself, and it MAY carry relations ONLY via the industry's
relation registry, never inline (the WO's NO-FORK shape discipline).

### The catalog structure

`INDUSTRY_TERM_CATALOGS` holds EXACTLY one entry for each of the
sixteen frozen `HARNESS_INDUSTRIES` members — the `Readonly<Record<
HarnessIndustry, ...>>` type enforces the exhaustiveness at compile
time and the battery pins the key set against the real imported list
(the same order). Each catalog is a non-empty ordered frozen array of
6-14 domain-honest terms (9-11 in the landed set);
`INDUSTRY_TERM_RELATIONS` mirrors the structure with 2-6 relations per
industry (5-6 in the landed set).

### The relation classes (the reciprocity table)

The frozen class vocabulary is the WO's guidance list verbatim —
`broader-than`, `narrower-than`, `related-to`, `part-of` — with the
reciprocity table (`TERM_RELATION_INVERSE_TABLE`) fixing the demanded
inverses:

| class | demanded inverse | reading |
|---|---|---|
| `broader-than` | `narrower-than` | a hypernym edge demands its hyponym mirror |
| `narrower-than` | `broader-than` | the twin of broader-than |
| `related-to` | `related-to` | symmetric: every edge demands its mirror |
| `part-of` | **none** (null) | one-directional containment — "each bi-directionally consistent WHERE THE CLASS DEMANDS IT", and part-of is the class that does not demand it |

Every relation is `{ fromTermKey, relationClass, toTermKey }` —
exactly three keys; both ends must resolve in the SAME industry's
catalog; no self-relations; no duplicate triples. The battery pins a
clean integrity walk for every one of the sixteen industries.

### The refusal taxonomy

Every domain refusal is the typed record
`{ ok: false, refusal: { reason, law, message, items? } }` — the WO's
exact shape. `ONTOLOGY_VALIDATION_REJECTION_REASONS` is the closed
frozen list in the exact WO walk order:

```
malformed-record, no-fork, unknown-key, missing-key, unknown-industry,
invalid-term-key, invalid-definition, duplicate-term-keys,
malformed-relation, unknown-relation-class, unknown-term-ref,
self-relation, duplicate-relation, missing-inverse-relation,
version-mismatch, empty-catalog
```

**THE FIRST-FAILURE WALK (a disclosed design decision):** where the
landed siblings collect the COMPLETE rejection table, this family's
WO-pinned refusal shape is the single typed record — so the walks
report the FIRST violated station in the frozen order, with `items`
naming EVERY offender at that station (never first-offender-only at
the reporting station). The station semantics: `no-fork` fires on
extra keys on term/relation ENTRIES (the DH-01 precedence law: the
shape station before the strict-schema station) while `unknown-key`
fires on extra ENVELOPE keys; `missing-key` fires on absent keys at
every level (the DH-01 absent-key discipline: an absent key is never a
structural station, and a NON-RECORD entry is its structural station's
business, never a missing-key cascade); `unknown-industry` checks the
REAL imported DH-01 list; `version-mismatch` is THE SINGLE-VERSION
LAW's live station on the serialization envelope; `empty-catalog`
closes the walk (the WO's order puts it last — a wrong version AND an
empty catalog reports version-mismatch first).

The kit layer extends the vocabulary with four extras (the WO's
lowercase `disposed` literal sets the family's kit-extra naming
convention — kebab-case, unlike the landed families' SCREAMING extras,
a disclosed design decision): `disposed` (THE DISPOSE LAW),
`corrupt-seam` (the injected clock returned a malformed value
mid-lookup), `malformed-term-set` / `empty-term-set` (the
validateTermSet carrier and floor stations).

The parse walk is first-failure-is-the-verdict over
`ONTOLOGY_PARSE_REJECTION_REASONS = ['malformed-json', 'torn-envelope',
'unknown-contract-version', 'unknown-key', 'invalid-record']` — the
landed five-reason shape; `unknown-contract-version` is LIVE in this
family (the envelope carries contractVersion).

### The serialization unit

The per-industry ontology envelope
`{ contractVersion, industry, terms, relations }`
(INDUSTRY_ONTOLOGY_SCHEMA_KEYS) — the canonical fixed-key-order JSON
unit (the DH-01 algorithm: the frozen per-shape key orders applied
deeply, never an alphabetic re-sort; the envelope keys, then each term
as `termKey, definition`, then each relation as `fromTermKey,
relationClass, toTermKey`). `buildIndustryOntologyEnvelope(industry)`
builds it over the frozen catalogs BY REFERENCE; the battery pins the
sixteen-envelope serialize→parse→serialize byte-identity.

### The instrument surface (the kit)

`createOntologyKit(options)` — factory misuse throws `TypeError` (the
DH-01 message shapes, the `createOntologyKit` prefix); the options
carry the injected `clock` ONLY. **THE STATELESS DESIGN (deliberate
and disclosed):** the instrument is pure over the frozen catalogs —
NO rng seam (it mints nothing), NO fsPort/root seam (it persists
nothing; persistence belongs to the session families DH-01/02/03).
The factory consumes exactly ONE clock read (the seam-validation
read, the landed-family factory precedent); `lookupTerm` consumes
exactly ONE read per SUCCESSFUL lookup, carried VERBATIM into the
lookup record's `at` (a refused lookup consumes no read — the record
never exists). All five ops are async with typed outcomes (the landed
family shape):

- `lookupTerm(industry, termKey)` — the resolved `DomainTerm` plus
  its relations in BOTH directions (`outgoingRelations` where the term
  is the source, `incomingRelations` where it is the target); the
  typed `unknown-term-ref` refusal on a miss (a malformed key fails
  closed as unknown — the roles-family precedent); `unknown-industry`
  outside the frozen sixteen.
- `validateTermSet(industry, termKeys)` — every key must resolve (the
  `unknown-term-ref` refusal listing EVERY offender), no duplicates
  (`duplicate-term-keys`), non-empty (`empty-term-set`); the ok result
  carries the resolved terms in CATALOG order (never caller order).
- `inspectCatalog(industry)` — the frozen catalog + registry BY
  REFERENCE (the battery pins the identity against the contract
  exports).
- `relationIntegrityReport(industry)` — THE INTEGRITY LAW's walk over
  the frozen registry as a typed REPORT (a value, never a throw):
  `{ industry, termCount, relationCount, clean, findings }`; the
  battery pins a clean report for every one of the sixteen industries.
- `dispose()` — THE DISPOSE LAW: every operation after dispose refuses
  `disposed`; dispose is idempotent.

### The scope boundary

NO workflow templates (DH-005's item), NO Agent Body defaults
(DH-006's), NO capability population (DH-007's), and NO changes to the
frozen DH-01 descriptor schema — the descriptor's alphabet stays the
frozen ten keys; terms are NOT a descriptor key; the ontology is a
harness-ADJACENT configuration layer. Pinned as a test in the contract
battery against the real module.

## The binding laws (inherited from the landed families)

1. **THE NO-FORK LAW** — a term is termKey + definition ONLY; the
   catalogs carry zero execution material; relations live in the
   registry, never inline on a term; any additional key on a term or
   a relation is the typed `no-fork` rejection.
2. **THE FROZEN-CATALOG LAW** — the sixteen term catalogs and the
   relation registries are frozen at this family; membership is the
   only admissibility; the relation-class vocabulary and the
   reciprocity table are frozen.
3. **THE REAL-VOCABULARY LAW** (this family's charter) — the
   industries are imported from the DH-01 contract, never re-declared;
   `HARNESS_INDUSTRIES` and `isHarnessIndustry` are the REAL bindings
   re-exported by reference (the battery pins referential identity).
4. **THE INTEGRITY LAW** — every relation end resolves in its
   catalog; the reciprocity classes carry their inverses (part-of
   exempt — the null row); no self-relations; no duplicates; the
   integrity walk is typed and never throws.
5. **THE DETERMINISM LAW** — no `Math.random`, no `Date.now`, no
   `new Date(...)`, no `process.env` in the shipped modules (law
   comments excepted; the battery greps pin this). Pure functions,
   injected clock, canonical bytes; same inputs → byte-identical
   outputs.
6. **THE FAIL-CLOSED LAW** — typed refusals naming the law + items
   (the single-refusal first-failure shape, per the WO); factory
   misuse `TypeError`; no silent partial effects.
7. **THE SINGLE-VERSION LAW** — `ONTOLOGY_CONTRACTS_VERSION` declared
   once in the contract module, re-carried by the kit (the re-export);
   `DOMAIN_HARNESS_CONTRACTS_VERSION` re-carried through the re-export
   chain; the batteries pin every copy equal.

## The frozen vocabularies

- `ONTOLOGY_CONTRACTS_VERSION = '1.0.0'`
- `TERM_KEY_MAX_LENGTH = 64`
- `TERM_DEFINITION_MAX_LENGTH = 300`
- `DOMAIN_TERM_SCHEMA_KEYS` (2): `termKey, definition`
- `TERM_RELATION_SCHEMA_KEYS` (3): `fromTermKey, relationClass, toTermKey`
- `TERM_RELATION_CLASSES` (4): `broader-than, narrower-than, related-to, part-of`
- `TERM_RELATION_INVERSE_TABLE` (4 rows): broader-than↔narrower-than,
  related-to self-symmetric, part-of null (no demanded inverse)
- `INDUSTRY_ONTOLOGY_SCHEMA_KEYS` (4): `contractVersion, industry, terms, relations`
- `INDUSTRY_TERM_CATALOGS` (16 industries × 9-11 terms)
- `INDUSTRY_TERM_RELATIONS` (16 industries × 5-6 relations)
- `ONTOLOGY_VALIDATION_REJECTION_REASONS` (16): the taxonomy above
- `ONTOLOGY_PARSE_REJECTION_REASONS` (5)
- `ONTOLOGY_KIT_EXTRA_REFUSAL_REASONS` (4): `disposed, corrupt-seam,
  malformed-term-set, empty-term-set`
- `ONTOLOGY_KIT_REFUSAL_REASONS` (20): the 16 domain + the 4 extras

## The battery

| receipt | command | expected |
|---|---|---|
| ontology battery (contract) | `bunx --bun mocha --ui tdd 'build/flauz/harness/ontology/test/common/ontologyContract.test.ts'` | 98 passing, 0 failing |
| ontology battery (kit) | `bunx --bun mocha --ui tdd 'build/flauz/harness/ontology/test/common/ontologyKit.test.ts'` | 47 passing, 0 failing |
| ontology battery (full) | `bunx --bun mocha --ui tdd 'build/flauz/harness/ontology/test/common/*.test.ts'` | 145 passing, 0 failing |
| type check | `npx tsc -p build/flauz/harness/ontology` | EXIT 0 (noEmit in the tsconfig) |
| determinism greps | `grep -nE 'Date\.now\|new Date\|Math\.random\|process\.env' build/flauz/harness/ontology/common/*.ts build/flauz/harness/ontology/test/common/*.test.ts` | law-comment lines only (zero in tests) |
| tsconfig parity | `diff build/flauz/harness/contract/tsconfig.json build/flauz/harness/ontology/tsconfig.json` | identical |
| sibling regression (contract) | `bunx --bun mocha --ui tdd 'build/flauz/harness/contract/test/common/*.test.ts'` | 181 passing, 0 failing |
| sibling regression (onboarding) | `bunx --bun mocha --ui tdd 'build/flauz/harness/onboarding/test/common/*.test.ts'` | 158 passing, 0 failing |
| sibling regression (roles) | `bunx --bun mocha --ui tdd 'build/flauz/harness/roles/test/common/*.test.ts'` | 152 passing, 0 failing |
| sibling regression (ops) | `bunx --bun mocha --ui tdd 'build/flauz/production/ops/test/common/*.test.ts'` | 137 passing, 0 failing |

## Provenance

The DH-004 work order (chat `a4874511`, base `aa803ae2957e`): the
family was authored SPEC-first in the worker's own workspace clone
(`flauz-dh004`, the blobless-clone + `--ignore-scripts` lane), the
gates run and the receipts recorded in the completion report; the
worker's receipts are claims until the station re-runs them. The
station-fixup precedent of DH-003 applied here too: the battery's own
first run caught one cascade defect (a non-record relation entry
cascading into the missing-key station) — fixed with the isRecord
guard on station 4 before any commit; disclosed in the completion
report's deviations.
