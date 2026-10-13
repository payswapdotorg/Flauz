# DH-004 domain-ontology family

The typed terminology layer for the Domain Harness OS direction
(WORK-REGISTRY.md, the wave-4 domain ontology/terminology family,
registry row DH-004 "domain ontology/terminology layer"): a harness is
domain-specific not only through its industry label (DH-01) and its
named roles (DH-003) but through its **domain terminology** — the
terms of art the domain's work is conducted in. **This family is that
layer**: a typed, staged, deterministic terminology record family
bound to a harness, composing term entries (configuration only), with
the family's validation, serialization and persistence laws.
Composition over the landed families: the frozen industry vocabulary,
the harness-id alphabet, the staged-session and the PIN-2 persistence
architecture are the LANDED DH-01/DH-02/DH-03 surfaces — imported
from the real modules, never re-declared, re-implemented or shadowed
(**THE IMPORT LAW**, this wave's charter). A term is CONFIGURATION (a
term of art plus its definition); it grants NOTHING by itself.

## 1. The SPEC (the design record)

### The surface inventory

```
build/flauz/harness/ontology/
  common/
    ontologyContract.ts   the pure contract module (no fs, no clock calls, no kit):
                          the frozen stage machine (composing -> composed, composed
                          TERMINAL - THE APPEND-ONLY LINEAGE LAW), the frozen term
                          laws (term <=64 trimmed no-control, definition <=300,
                          MAX_TERMS 256, the exactly-two-keys NO-FORK shape, unique
                          terms), the SIX-KEY record model, the frozen history-note
                          shape, the complete-table validation walk in the frozen
                          station order, the canonical fixed-key-order serialization +
                          the fail-closed parse, ONTOLOGY_CONTRACTS_VERSION '1.0.0'
    ontologyKit.ts        the deterministic kit over the injected seams (clock,
                          rng, fsPort, root): beginOntology / addTerm /
                          replaceTermDefinition / removeTerm / finalizeOntology /
                          inspectOntology / listOntologies / dispose /
                          loadOntologyKit, all async with typed outcomes; the
                          PIN-2-style persistence mirror
  test/
    common/
      ontologyContract.test.ts   the contract battery (59 tests)
      ontologyKit.test.ts        the kit battery (67 tests)
  tsconfig.json      byte-parity with build/flauz/harness/contract/tsconfig.json
  README.md          this file
```

### The refusal taxonomy

Every domain refusal is the typed record
`{ ok: false, mode: 'shape', rejections: readonly OntologyRejection[] }`
with the COMPLETE table in the frozen walk order (never first-only) —
`ONTOLOGY_REJECTION_REASONS` (18; the sixteen work-order stations
verbatim in order, plus the two WO-authorized appended stations):

```
malformed-record, unknown-key, missing-key, malformed-harness-id,
unknown-industry, malformed-term, no-fork, invalid-term,
invalid-definition, duplicate-term, max-terms-exceeded, empty-terms,
unknown-record, version-mismatch, unknown-stage, malformed-history,
stale-stage, unknown-term
```

The absent-key discipline (the DH-01 law): an absent key is the
`missing-key` station, never a structural/field one — a field station
fires only on a PRESENT-but-invalid value. Empty terms are LEGAL in
the record shape (the `empty-terms` floor fires at finalize, never
the walk). `version-mismatch` never fires on THE SIX-KEY MODEL (the
record carries no contractVersion; the single-version law is enforced
at the kit-layer persistence surfaces — every ledger line and the
envelope carry `ONTOLOGY_CONTRACTS_VERSION`). The kit layer adds the
six frozen extras `DISPOSED, CORRUPT_SEAM, E_LEDGER_TORN,
E_ENVELOPE_MISMATCH, ONTOLOGY_IO, UNKNOWN_FILTER` (24 refusal reasons
in all).

### The term laws

- A term entry carries EXACTLY `{ term, definition }` — an extra key
  is the typed `no-fork` rejection (**THE NO-FORK LAW**'s term
  station; a term is configuration, it grants NOTHING by itself).
- `term`: non-empty, at most `TERM_MAX_LENGTH` (64) characters, NO
  leading/trailing whitespace, no control characters (C0/DEL/C1).
- `definition`: non-empty, at most `DEFINITION_MAX_LENGTH` (300)
  characters, no control characters (padding is legal — a definition
  is prose; the no-padding law is the term's, the name of art's).
- Terms are unique within the ontology (`duplicate-term`); the
  composition holds at most `MAX_TERMS` (256) terms.
- At least one term at finalize (the `empty-terms` floor fires THERE,
  never the record shape — a composing record may hold zero).
- **THE REMOVE+RE-ADD LAW**: a term is its identity — immutable once
  added. `replaceTermDefinition` replaces ONLY the definition; a
  changed term is a NEW term (remove, then re-add). Removing the last
  term is LEGAL while composing.

### The harness binding

`beginOntology(harnessId, industry)` binds the record to a harness:
the harnessId must satisfy the **REAL DH-01 harness-id alphabet**
(`flauz:hrn:<16-hex>`, imported by reference — the FORM law, enforced
at the contract walk's `malformed-harness-id` station and again at
the kit boundary); the industry must be a REAL `HARNESS_INDUSTRIES`
member (the ontology's scope). The **EXISTENCE** binding (a harness
record actually resolves under that id) and the **AGREEMENT** binding
(the ontology's industry equals the bound harness descriptor's own
industry) are the CALLER'S composition laws — never this layer's
(the DH-03 precedent: the layer enforces form and membership, the
caller wires the cross-record truth). Both are pinned in the battery
through the REAL `createHarnessKit`: the crown journey mints a
harness, binds it, composes and finalizes the terminology, and
cross-checks the binding surfaces against the minted descriptor; a
second pin discloses the honest boundary (a disagreeing industry is
admitted by the layer — the caller's law, never the layer's).

### The staged model + the append-only lineage law

```
composing -> composed
             (TERMINAL — every mutating op on a composed record
              refuses with the stage law)
```

`composed` is TERMINAL and **THE APPEND-ONLY LINEAGE LAW** holds: the
Lab-driven specialization (DH-012) mints NEW lineage records — nothing
ever mutates a composed one. A changed terminology is a NEW record.

### THE HONEST-GAP DISCLOSURE (THE CONTENT LAW)

**No per-industry term templates are shipped.** Industry template
content is a later wave's territory — the registry's DH-002 precedent
("industry role templates are LATER waves — do not invent them")
applies verbatim to term templates. This wave is the LAYER, the
machinery: the term laws, the staged record, the binding, the
persistence. An invented legal/medical/finance vocabulary would be an
unsourced fork of domain truth; the caller composes the terms, this
family never invents them. The kit injects NO catalog — the ontology
resolves nothing.

### The persistence model

The same `.flauz/harness` subtree as the landed families, distinct
files: `.flauz/harness/ontology-ops.jsonl` (one canonical JSON line
per applied op; the seq is strictly increasing and equals the line
number) and `.flauz/harness/ontology-records.json` (the envelope
`{ contractVersion, seq, records }`, records sorted by ontologyId,
each the canonical fixed-key-order record bytes). The ledger line is
the ELEVEN-KEY shape — the harness link is its own column (`harnessId`,
the REAL DH-01 id alphabet, validated on every replayed line).
`loadOntologyKit` replays the ledger (each line re-validated: the
frozen line schema, the seq, the op, the stage edges, the term
payload's full validation, the duplicate/MAX_TERMS bounds, the remove
line's entry-as-it-stood cross-check, the finalize floor),
cross-checks the envelope byte-for-byte (a torn or missing line is
the typed `E_LEDGER_TORN`; a divergent envelope is the typed
`E_ENVELOPE_MISMATCH`, never silently rebuilt), and re-opens
restart-deterministic. A fresh `createOntologyKit` never appends over
an existing non-empty ledger — reopen with `loadOntologyKit`. The
factory consumes exactly ONE clock read and ONE rng read (pinned by
the battery).

## The binding laws (inherited from the landed families)

1. **THE IMPORT LAW** (this family's charter) — every landed surface
   is imported from the real modules (`isHarnessId`,
   `isHarnessIndustry`, `HARNESS_INDUSTRIES`, `HARNESS_ID_PREFIX`,
   `DOMAIN_HARNESS_CONTRACTS_VERSION`, `ONBOARDING_CONTRACTS_VERSION`,
   `ROLES_CONTRACTS_VERSION`, the DH-01 kit's `HarnessFsPort`); zero
   re-declared vocabularies, zero shadowed validators; the batteries
   pin referential identity and both-directional verbatim equality.
2. **THE NO-FORK LAW** — term entries carry EXACTLY
   `{ term, definition }` (an extra key is the typed `no-fork`
   refusal); a term grants NOTHING by itself.
3. **THE FORWARD-ONLY LAW / THE APPEND-ONLY LINEAGE LAW** —
   composing -> composed, composed TERMINAL; `stale-stage` is the
   typed stage refusal; the DH-012 Lab specialization mints NEW
   lineage records.
4. **THE COMPLETE-TABLE LAW** — the validation walk reports every
   violated station in the frozen order, never first-only; a typed
   refusal leaves the record unchanged.
5. **THE DETERMINISM LAW** — no `Math.random`, no `Date.now`, no
   `new Date(...)`, no `process.env` in the shipped modules (law
   comments excepted; the battery greps pin this). The clock, the rng
   and the fsPort are INJECTED seams; the persisted bytes are
   canonical fixed-key-order JSON; restart determinism is pinned
   byte-for-byte.
6. **THE FAIL-CLOSED LAW** — factory misuse throws `TypeError`; every
   domain refusal is the typed record naming the violated law and the
   offending items.
7. **THE SINGLE-VERSION LAW** — `ONTOLOGY_CONTRACTS_VERSION = '1.0.0'`
   declared ONCE in the contract module, re-carried by the kit; the
   DH-01/DH-02/DH-03 versions re-carried through the re-export chain;
   the batteries pin every copy equal.
8. **THE APPEND-ONLY LEDGER LAW** — as the persistence model above.
9. **THE CONTENT LAW** — no per-industry term templates; the layer,
   never the domain content (the honest-gap disclosure above).

## The frozen vocabularies

- `ONTOLOGY_CONTRACTS_VERSION = '1.0.0'`
- `ONTOLOGY_ID_PREFIX = 'flauz:ont:'`
- `ONTOLOGY_STAGES = ['composing', 'composed']`
- `TERM_MAX_LENGTH = 64`, `DEFINITION_MAX_LENGTH = 300`,
  `MAX_TERMS = 256`
- `ONTOLOGY_RECORD_SCHEMA_KEYS` (6): `ontologyId, harnessId,
  industry, stage, terms, history` (THE SIX-KEY MODEL — no
  contractVersion field)
- `ONTOLOGY_NOTE_SCHEMA_KEYS` (6): `at, fromStage, toStage, op, law,
  detail`
- `ONTOLOGY_OP_NAMES` (5): `begin-ontology, add-term,
  replace-term-definition, remove-term, finalize-ontology`
- `ONTOLOGY_REJECTION_REASONS` (18): the taxonomy above
- `ONTOLOGY_ENVELOPE_RELATIVE_PATH = '.flauz/harness/ontology-records.json'`
- `ONTOLOGY_LEDGER_RELATIVE_PATH = '.flauz/harness/ontology-ops.jsonl'`

## The battery

| receipt | command | expected |
|---|---|---|
| ontology battery (contract) | `bunx --bun mocha --ui tdd 'build/flauz/harness/ontology/test/common/ontologyContract.test.ts'` | 59 passing, 0 failing |
| ontology battery (kit) | `bunx --bun mocha --ui tdd 'build/flauz/harness/ontology/test/common/ontologyKit.test.ts'` | 67 passing, 0 failing |
| ontology battery (full) | `bunx --bun mocha --ui tdd 'build/flauz/harness/ontology/test/common/*.test.ts'` | 126 passing, 0 failing |
| type check | `NODE_OPTIONS=--max-old-space-size=2048 <tsc> -p build/flauz/harness/ontology/tsconfig.json --noEmit` | EXIT 0 (noEmit in the tsconfig) |
| determinism greps | `grep -nE 'Date\.now\|new Date\|Math\.random\|process\.env' build/flauz/harness/ontology/common/*.ts` | law-comment lines only |
| tsconfig parity | `diff build/flauz/harness/contract/tsconfig.json build/flauz/harness/ontology/tsconfig.json` | identical |
| sibling regression (contract) | `bunx --bun mocha --ui tdd 'build/flauz/harness/contract/test/common/*.test.ts'` | 181 passing, 0 failing |
| sibling regression (onboarding) | `bunx --bun mocha --ui tdd 'build/flauz/harness/onboarding/test/common/*.test.ts'` | 158 passing, 0 failing |
| sibling regression (roles) | `bunx --bun mocha --ui tdd 'build/flauz/harness/roles/test/common/*.test.ts'` | 152 passing, 0 failing |
| sibling regression (ops) | `bunx --bun mocha --ui tdd 'build/flauz/production/ops/test/common/*.test.ts'` | 137 passing, 0 failing |

## Provenance

The DH-004 worker lane (chat e3b4785e): the family was authored at
the pinned post-DH-003 frontier `aa803ae2957` on branch
`flauz-dh/dh004-domain-ontology` (credential-free, local commit
only; the station harvests and lands it). All receipts above were
re-run in-sandbox at the pinned base; the baseline gates (fixtures
232 / fork-critical EMPTY / compat 1887 / activation GREEN / parity
21-71-0) hold before and after the change.
