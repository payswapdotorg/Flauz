# DH-001 DomainHarness contract family

The typed composable-configuration vocabulary for the Domain Harness
OS direction (MASTER-ROADMAP.md): the product must transform into the
domain-specific work harness selected by a user during onboarding —
`industry selection -> harness instantiation -> domain
ontology/roles/workflows/capabilities/policy/evidence/UI`. A harness
is **composable configuration over the universal Flauz core, NOT an
industry-specific fork**. This family builds that law's contract
layer: the frozen industry / work-type vocabularies, the harness
lifecycle machine, the reference-only descriptor with its NO-FORK and
NO-DANGLING-REF validation, the injected read-only catalog snapshot
seam, and the canonical fixed-key-order serialization with the
fail-closed parse. The W7 production ops family
(`build/flauz/production/ops/**`) is the landed precedent; its laws
are inherited and binding.

## Charter (the binding laws)

1. **THE NO-FORK LAW (this family's charter):** a harness is
   composable configuration over the universal Flauz core. The
   descriptor's alphabet is references ONLY — it cannot carry
   commands, tools, implementations, code, patches or any execution
   material. The structural engine has three stations: (a) the
   strict-schema parse rejects every UNKNOWN key; (b) the
   forbidden-key family (`command`, `commands`, `tool`, `tools`,
   `implementation`, `code`, `script`, `inline`, `patch`, `fork`) is
   rejected with the typed NO-FORK rejection even before the strict
   schema's unknown-key rejection would fire; (c) role entries carry
   only `roleKey` + `summary` — any additional key is the NO-FORK
   rejection. A named role is CONFIGURATION (a key + a human
   summary); it grants NOTHING by itself.

2. **THE NO-DANGLING-REF LAW:** every reference must resolve against
   the injected catalog snapshot at the propose boundary — a dangling
   ref is the typed DANGLING_REF rejection listing every offender,
   never a silent skip. Each dangling family (capabilityRefs,
   workflowRefs, policyRefs, evidenceRefs) is reported with its own
   offending refs.

3. **THE FROZEN-VOCABULARY LAW:** the industry and work-type lists
   are frozen with their exact list order; membership is the only
   admissibility; `workTypes` is a non-empty, duplicate-free ordered
   subset (the frozen list order preserved).

4. **THE FORWARD-ONLY LIFECYCLE LAW:** draft -> proposed -> approved
   -> active -> retired; typed forward transitions only; `retired` is
   TERMINAL (no reopen — a changed harness is a NEW harness id, the
   registry lineage law); the descriptor is IMMUTABLE (a change is a
   new mint — no in-place mutation, the registry drift law).

5. **THE TWO-PHASE LAW:** a draft composes gradually — dangling refs
   mint fine at draft (the spec is validated for vocabulary + shape
   IMMEDIATELY at mint); resolution is enforced at the propose
   boundary.

6. **THE CATALOG-BINDING LAW:** a harness is NEVER approved over an
   unapproved capability — every capabilityRef must sit at `approved`,
   `enabled` or `available` in the catalog snapshot at the approve
   boundary (fail-closed escalation).

7. **THE DETERMINISM LAW:** no `Math.random`, no `Date.now`, no
   `new Date(...)`, no `process.env` in the shipped modules (law
   comments excepted; the in-suite determinism greps pin this). The
   clock, the rng and the catalog are INJECTED seams; the
   serialization is canonical fixed-key-order bytes.

8. **THE FAIL-CLOSED LAW:** factory misuse throws `TypeError`; every
   domain refusal is a typed record naming the violated law and the
   offending items — never a string throw, never a silent skip, never
   a partial effect.

9. **THE SINGLE-VERSION LAW:** `DOMAIN_HARNESS_CONTRACTS_VERSION` is
   `'1.0.0'` declared ONCE in the contract module, re-carried by the
   kit (the re-export); the battery pins both copies equal.

10. **THE APPEND-ONLY LEDGER LAW:** the persisted ops ledger is
    append-only (one canonical JSON line per applied op, the seq
    strictly increasing and equal to the line number); `loadHarnessKit`
    replays the ledger (the authoritative surface) and cross-checks
    the envelope byte-for-byte — a torn or missing ledger line is the
    typed `E_LEDGER_TORN`; a divergent envelope is the typed
    `E_ENVELOPE_MISMATCH`, never silently rebuilt.

## The frozen vocabularies

- `DOMAIN_HARNESS_CONTRACTS_VERSION = '1.0.0'`
- `HARNESS_INDUSTRIES` (16, the onboarding selection list, frozen at
  DH-001, bound by DH-002+):

  `software, legal, finance, healthcare, education, marketing,
  science, media, construction, logistics, retail, manufacturing,
  energy, agriculture, government, hospitality`

- `HARNESS_WORK_TYPES` (10, the frozen list order):

  `analysis, drafting, review, planning, research, reporting,
  data-processing, compliance, communication, administration`

- `HARNESS_LIFECYCLE_STATES = ['draft', 'proposed', 'approved', 'active', 'retired']`
- `HARNESS_LIFECYCLE_FORWARD_TRANSITIONS`: `draft->proposed`,
  `proposed->approved`, `approved->active`, `active->retired`
  (forward-only; `retired` is terminal)
- `FORBIDDEN_HARNESS_DESCRIPTOR_KEYS`: `command, commands, tool,
  tools, implementation, code, script, inline, patch, fork`
- `HARNESS_CAPABILITY_BINDING_STATES = ['approved', 'enabled', 'available']`
- `HARNESS_VALIDATION_REJECTION_REASONS` (17, the exact walk order):
  `malformed-descriptor, no-fork, unknown-key, missing-key,
  unknown-harness-id, version-mismatch, unknown-industry,
  empty-work-types, unknown-work-type, duplicate-work-types,
  work-types-out-of-order, invalid-display-name, empty-roles,
  malformed-role, duplicate-role-keys, duplicate-ref, dangling-ref`
- `HARNESS_PARSE_REJECTION_REASONS` (5, the first-failure order):
  `malformed-json, torn-envelope, unknown-contract-version,
  unknown-key, invalid-record`
- `HARNESS_KIT_REFUSAL_REASONS` (11): `DISPOSED, E_LEDGER_TORN,
  E_ENVELOPE_MISMATCH, HARNESS_IO, CORRUPT_SEAM, NOT_FOUND,
  ILLEGAL_TRANSITION, VALIDATION_REFUSED, CATALOG_BINDING_REFUSED,
  MALFORMED_DECISION, UNKNOWN_FILTER`

## The lifecycle graph

```
draft -> proposed -> approved -> active -> retired
                                          (terminal: no reopen;
                                           a changed harness is a
                                           NEW harness id)
```

- `draft -> proposed`: FULL validation must be green (the
  NO-DANGLING check included) or the typed `VALIDATION_REFUSED`
  refusal carrying the complete outcome. No decision.
- `proposed -> approved`: THE CATALOG-BINDING LAW — every
  capabilityRef must sit at `approved`/`enabled`/`available` in the
  catalog snapshot; the decision carries `{ approvedBy, note? }`.
- `approved -> active`: the operator act; the decision carries
  `{ activatedBy }`.
- `active -> retired`: terminal; the decision carries
  `{ retiredBy, reason? }`.

## The reference-only descriptor law

`DomainHarnessDescriptor` carries exactly ten keys: `harnessId` (the
`flauz:hrn:<16-hex>` id, minted from the injected rng, never
caller-supplied), `contractVersion`, `industry`, `workTypes`,
`displayName` (non-empty, at most 80 chars), `roles` (non-empty,
unique roleKeys), and the four reference families `capabilityRefs` /
`workflowRefs` / `policyRefs` / `evidenceRefs` (string arrays;
duplicate-free; MAY be empty — a draft composes gradually). The
canonical serialization emits the frozen fixed key orders (the
record, the descriptor, the role entries, the history notes, the
decisions, the validation outcomes); `parseHarnessRecord` fails
closed on malformed JSON, a torn envelope, an unknown contract
version, unknown keys and invalid content — never a silent partial
parse.

## The catalog seam (DH-002 binds the real authorities)

`HarnessCatalogSnapshot` is the injected READ-ONLY resolution surface
— `{ capabilities: Array<{ entryId, state }>, workflowIds, policyIds,
evidenceIds }` — mirroring the CR-006 capability registry's
entry/state shape for capabilities. DH-001 tests inject fixtures;
DH-002+ binds the real authorities (the capability registry, the
workflow / policy / evidence authorities) onto this stable seam. A
malformed catalog resolves nothing (fail-closed).

## Persistence (the PIN-2 sibling precedent)

When `fsPort` + `root` are injected: the envelope
`.flauz/harness/harnesses.json` and the append-only ops ledger
`.flauz/harness/harness-ops.jsonl` (both relative to the root). The
ledger is authoritative (one canonical line per applied op; the seq
equals the line number); the envelope is rewritten after each append
and cross-checked byte-for-byte at load. `loadHarnessKit(...)`
replays the ledger and refuses closed on any drift; a fresh
`createHarnessKit` never appends over an existing non-empty ledger
(reopen with `loadHarnessKit`).

## Module map

```
build/flauz/harness/contract/
  common/
    domainHarnessContract.ts   the frozen vocabularies, the lifecycle verdict machine, the
                               reference-only descriptor walk (NO-FORK + NO-DANGLING), the
                               canonical serialization and the fail-closed parse
    domainHarnessKit.ts        the deterministic kit (injected clock / rng / catalog / fsPort;
                               mint, advance, inspect, list, dispose, loadHarnessKit)
  test/
    common/
      domainHarnessContract.test.ts   the contract battery (104 tests)
      domainHarnessKit.test.ts        the kit battery (77 tests)
  tsconfig.json               the family's scoped test-program posture (the W7 shape)
  README.md                   this file
```

## Verification receipts

| receipt | command | expected |
|---|---|---|
| harness battery (contract) | `bunx --bun mocha --ui tdd 'build/flauz/harness/contract/test/common/domainHarnessContract.test.ts'` | 104 passing, 0 failing |
| harness battery (kit) | `bunx --bun mocha --ui tdd 'build/flauz/harness/contract/test/common/domainHarnessKit.test.ts'` | 77 passing, 0 failing |
| harness battery (full) | `bunx --bun mocha --ui tdd 'build/flauz/harness/contract/test/common/*.test.ts'` | 181 passing, 0 failing |
| type check | `NODE_OPTIONS=--max-old-space-size=2048 tsc -p build/flauz/harness/contract/tsconfig.json --noEmit` | 0 errors |
| determinism greps | `grep -nE "Date\.now\|Math\.random\|new Date\(\|process\.env" build/flauz/harness/contract/common/*.ts` | law-comment lines only |
| sibling regression | `bunx --bun mocha --ui tdd 'build/flauz/production/ops/test/common/*.test.ts'` | 137 passing, 0 failing |

(The typecheck runs over an isolated toolchain —
`~/toolchain/node_modules/.bin/tsc` with `@types/node` + `@types/mocha`
resolvable — per the station recipe; a repo `npm install` is never
needed.)
