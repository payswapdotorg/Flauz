# DH-007 · the domain capability-pack population family (`build/flauz/harness/packs/`)

SPEC-first charter (registry row DH-007, "domain capability-pack
population"; the MASTER-ROADMAP law: a harness is composable
configuration over the universal Flauz core, never an industry fork;
the Agent Body law: "Agent Body + selected model + permitted
capabilities = Agent Instance"). A harness is domain-specific through
its industry label (DH-01), its onboarding record (DH-02), its named
roles (DH-03), its domain terms (DH-04), its task/workflow templates
(DH-05) and its organization's default agent bodies (DH-06) — and
through its **capability packs**: the named default capability packs
the domain's work runs on. This family is the DOMAIN-SIDE DEFAULTS
layer for capability packs: a typed, staged, deterministic
`CapabilityPacksRecord` family bound to a harness, composing pack
entries (configuration only) whose body references bind to the DH-006
organization-defaults record, with the family's validation,
serialization and persistence laws. It composes over the landed
families — the frozen industry vocabulary, the harness-id alphabet,
the staged-session architecture, the body shape and the PIN-2
persistence pattern are imported from the real modules, never
re-implemented (THE IMPORT LAW).

## THE CONTENT LAW (this wave's honesty)

**No per-industry pack content is shipped.** This wave ships the
LAYER, the machinery — not domain content. The registry's DH-002
precedent ("industry templates are LATER waves — do not invent them")
applies verbatim to capability packs: an invented legal / medical /
finance pack vocabulary would be an unsourced fork of domain truth.
The caller composes the packs; this family never invents them.

## The pack laws

- A pack entry is CONFIGURATION: exactly `{ packKey, summary, bodyRefs }`
  (THE NO-FORK LAW — an extra key is the typed no-fork rejection; a
  pack grants NOTHING by itself).
- `packKey`: non-empty, at most 64 chars, no leading/trailing
  whitespace, no control characters; unique within the record.
- `summary`: non-empty, at most 200 chars, no control characters.
- `bodyRefs`: a duplicate-free string array, MAY be empty (the
  honest-gap law: a pack MAY name zero bodies — an organization-wide
  capability).
- At most `MAX_PACKS` (64) packs per record; at least one pack at
  finalize (the empty-packs floor — the refusal fires at the
  boundary, never the record shape).

## The harness binding

The record binds to a harness through the REAL DH-01 harness-id
alphabet (`flauz:hrn:<16-hex>`, imported by reference — the FORM law,
enforced at `beginPacks` and in the record walk). The EXISTENCE
binding is the caller's wiring, never this layer's; the cross-kit
integration pins bind it end-to-end through the real DH-01 kit.

## The body-resolution boundary (THE BODY-RESOLUTION LAW)

`bodyRefs` resolve ONLY against the CALLER-SUPPLIED composed
`OrganizationDefaultsRecord` (the DH-006 record) at the
`finalizePacks` boundary — never an injected authority (the kit
injects no catalog and no bodies record; the options carry only the
clock, the rng and the optional fs port/root pair). The two-phase
law: dangling bodyRefs are LEGAL while composing; the boundary
refuses typed (`dangling-body-ref`, naming each offending ref once,
in first-seen order). A caller-supplied bodies record that fails the
REAL DH-06 `validateOrganizationDefaultsRecord` walk, or is not at
`composed`, is the typed `malformed-bodies` refusal (fail closed — a
malformed or non-composed authority resolves nothing, never a silent
skip). The finalize ledger line carries the bodies record AS IT
STOOD, so the replay re-proves the boundary law from the ledger
alone.

## The staged model + the append-only lineage law

`composing -> composed`; `composed` is TERMINAL (THE APPEND-ONLY
LINEAGE LAW — a changed pack is a NEW pack, never a mutation of a
composed one; every mutating op on a composed record refuses with the
typed stale-stage refusal). A pack's key is its identity (THE
REMOVE+RE-ADD LAW): `replacePackSummary` replaces only the summary; a
changed packKey is a new pack (remove, then re-add); removing the last
pack is legal while composing. `emitCapabilityRef` emits the composed
record's id as the capabilityRef string — a pure read, only from a
COMPOSED record. The emitted reference rides the DH-02 review
composition's `capabilityRefs` family (a string, duplicate-free): the
landed DH-02 surface carries exactly four ref families
(`capabilityRefs / workflowRefs / policyRefs / evidenceRefs`), and
`capabilityRefs` is the capability-side slot for the domain's default
capability packs ("Agent Body + permitted capabilities = Agent
Instance").

## The persistence model (the PIN-2 mirror)

The append-only ops ledger `.flauz/harness/packs-ops.jsonl` (one
canonical JSON line per applied op; the seq equals the line number)
and the envelope `.flauz/harness/packs-records.json`
(`{ contractVersion, seq, records }`). The ledger is authoritative;
`loadPacksKit` replays it and cross-checks the envelope byte-for-byte
(`E_LEDGER_TORN` / `E_ENVELOPE_MISMATCH` — never silently rebuilt; a
version-bearing surface carrying another contract version is the typed
version-mismatch — the six-key record carries no version field). Lazy
persistence; a fresh kit never appends over a non-empty ledger;
restart-deterministic.

## The battery

| suite | file | passing |
| --- | --- | --- |
| packs contract | `test/common/packsContract.test.ts` | 62 |
| packs kit | `test/common/packsKit.test.ts` | 56 |
| **family total** | `test/common/*.test.ts` | **118** |

Run recipes (the landed family recipe; bun is preinstalled):

```sh
NODE_OPTIONS=--max-old-space-size=2048 <tsc> -p build/flauz/harness/packs/tsconfig.json --noEmit
bunx --bun mocha --ui tdd 'build/flauz/harness/packs/test/common/*.test.ts'
grep -nE "Date\.now|Math\.random|new Date\(|process\.env" build/flauz/harness/packs/common/*.ts   # law-comment lines only
```
