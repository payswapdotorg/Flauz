# DH-006 · the domain Agent Body / organization-defaults family (`build/flauz/harness/bodies/`)

SPEC-first charter (registry row DH-006, "domain Agent Body/organization
defaults"; the MASTER-ROADMAP Agent Body law: Agent Bodies are
model-independent executable structures defining role, input/output
contract, tools, policy constraints; Agent Body + selected model +
permitted capabilities = Agent Instance; the Lab must not create a
second model router — this wave is the DOMAIN-SIDE DEFAULTS layer, the
configuration that later waves and the Lab compose into instances). A
harness is domain-specific not only through its industry label
(DH-01), its named roles (DH-03), its domain terms (DH-04) and its
task/workflow templates (DH-05) but through its **organization's
default agent bodies** — the named default body shapes the domain's
work runs on. This family is that layer: a typed, staged,
deterministic `OrganizationDefaultsRecord` family bound to a harness,
composing body entries (configuration only) whose role references
bind to the DH-03 roles record, with the family's validation,
serialization and persistence laws. It composes over the landed
families — the frozen industry vocabulary, the harness-id alphabet,
the staged-session architecture and the PIN-2 persistence pattern are
imported from the real modules, never re-implemented (THE IMPORT LAW).

## THE CONTENT LAW (this wave's honesty)

**No per-industry body or organization content is shipped.** This wave
ships the LAYER, the machinery — not domain content. The registry's
DH-002 precedent ("industry templates are LATER waves — do not invent
them") applies verbatim: an invented legal / medical / finance agent
body vocabulary would be an unsourced fork of domain truth. The caller
composes the bodies; this family never invents them.

## The body laws

- A body entry is CONFIGURATION: exactly `{ bodyKey, summary, roleRefs }`
  (THE NO-FORK LAW — an extra key is the typed no-fork rejection; a
  body grants NOTHING by itself).
- `bodyKey`: non-empty, at most 64 chars, no leading/trailing
  whitespace, no control characters; unique within the record.
- `summary`: non-empty, at most 200 chars, no control characters.
- `roleRefs`: a duplicate-free string array, MAY be empty (the
  honest-gap law: a body MAY name zero roles).
- At most `MAX_BODIES` (64) bodies per record; at least one body at
  finalize (the DH-01 floor — the empty-bodies refusal fires at the
  boundary, never the record shape).

## The harness binding

The record binds to a harness through the REAL DH-01 harness-id
alphabet (`flauz:hrn:<16-hex>`, imported by reference — the FORM law,
enforced at `beginDefaults` and in the record walk). The EXISTENCE
binding is the caller's wiring, never this layer's; the cross-kit
integration pins bind it end-to-end through the real DH-01 kit.

## The role-resolution boundary (THE ROLE-RESOLUTION LAW)

`roleRefs` resolve ONLY against the CALLER-SUPPLIED composed
`RoleCompositionSession` (the DH-03 record) at the `finalizeDefaults`
boundary — never an injected authority (the kit injects no catalog and
no roles record; the options carry only the clock, the rng and the
optional fs port/root pair). The two-phase law: dangling roleRefs are
LEGAL while composing; the boundary refuses typed (`dangling-role-ref`,
naming every offending ref). A caller-supplied roles record that fails
the REAL DH-03 `validateRoleCompositionSession` walk, or is not at
`composed`, is the typed `malformed-roles` refusal (fail closed — a
malformed authority resolves nothing). The finalize ledger line
carries the roles record AS IT STOOD, so the replay re-proves the
boundary law from the ledger alone.

## The staged model + the append-only lineage law

`composing -> composed`; `composed` is TERMINAL (THE APPEND-ONLY
LINEAGE LAW — a changed body is a NEW body, never a mutation of a
composed one; every mutating op on a composed record refuses with the
typed stale-stage refusal). A body's key is its identity (THE
REMOVE+RE-ADD LAW): `replaceBodySummary` replaces only the summary; a
changed bodyKey is a new body (remove, then re-add); removing the last
body is legal while composing. `emitOrganizationRef` emits the
composed record's id as the organizationRef string — a pure read, only
from a COMPOSED record. The emitted reference rides the DH-02 review
composition's `capabilityRefs` family (a string, duplicate-free): the
landed DH-02 surface carries exactly four ref families
(`capabilityRefs / workflowRefs / policyRefs / evidenceRefs` — the
REAL `HARNESS_REF_FAMILIES` import), and `capabilityRefs` is the
capability-side slot for the org's default agent-body shapes ("Agent
Body + permitted capabilities = Agent Instance"); a true org-refs
family would be a later wave's versioned DH-02 widening, never this
layer's to invent.

## The persistence model (the PIN-2 mirror)

The append-only ops ledger `.flauz/harness/bodies-ops.jsonl` (one
canonical JSON line per applied op; the seq equals the line number)
and the envelope `.flauz/harness/bodies-records.json`
(`{ contractVersion, seq, records }`). The ledger is authoritative;
`loadBodiesKit` replays it and cross-checks the envelope byte-for-byte
(`E_LEDGER_TORN` / `E_ENVELOPE_MISMATCH` — never silently rebuilt; a
version-bearing surface carrying another contract version is the typed
version-mismatch — the six-key record carries no version field). Lazy
persistence; a fresh kit never appends over a non-empty ledger;
restart-deterministic.

## The battery

| suite | file | passing |
| --- | --- | --- |
| bodies contract | `test/common/bodiesContract.test.ts` | 48 |
| bodies kit | `test/common/bodiesKit.test.ts` | 54 |
| **family total** | `test/common/*.test.ts` | **102** |

Run recipes (the landed family recipe; bun is preinstalled):

```sh
NODE_OPTIONS=--max-old-space-size=2048 <tsc> -p build/flauz/harness/bodies/tsconfig.json --noEmit
bunx --bun mocha --ui tdd 'build/flauz/harness/bodies/test/common/*.test.ts'
grep -nE "Date\.now|Math\.random|new Date\(|process\.env" build/flauz/harness/bodies/common/*.ts   # law-comment lines only
```
