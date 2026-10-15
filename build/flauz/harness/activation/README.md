# DH-011 · the end-to-end onboarding/activation journey family (`build/flauz/harness/activation/`)

SPEC-first charter (registry row DH-011, "onboarding -> harness
proposal -> approval -> activation"; ARCHITECTURE-LOCK 12.5: the
domain-harness law — a harness is a composition over the universal
Flauz core, and "a user may hold multiple roles/specializations";
12.6: the no-new-authority law — no second scheduler, journal,
permission broker, model router or persistence authority). DH-011
proves the COMPLETE user journey

```
industry selection -> company/work type -> roles and workloads
  -> proposed harness -> validation -> user inspection and approval
  -> activation -> usable harness
```

as ONE typed, staged, deterministic instrument — the activation
journey kit — that drives the WHOLE chain THROUGH THE REAL LANDED
KITS and never re-implements any of them: the REAL DH-002 onboarding
kit (the session's own selection walk + `composeDraft` /
`proposeSession`), the REAL DH-003 role-composition kit (THE
MULTI-ROLE LAW), the REAL DH-04..DH-09 ontology / templates / bodies
/ packs / profiles / benchmarks kits (the staged record composition
with their cross-record finalize boundaries and emitted refs), and
the REAL DH-001 harness kit (the draft mint through the onboarding
kit; the post-proposal lifecycle legs reopened and advanced through
the authority's OWN `loadHarnessKit` / `advanceHarness` surfaces).
Everything is imported by reference (THE IMPORT LAW): the family
versions, the industry/work-type vocabularies, the lifecycle states,
the catalog binding states, the id alphabets, the record validators —
never transcribed, never re-declared.

## THE EVIDENCE-NOT-AUTHORITY LAW (this family's first law)

The journey record is **EVIDENCE of the run, never a second
lifecycle authority**. The REAL DH-01 harness record (its ledger, its
envelope, its lifecycle machine) remains the ONLY lifecycle
authority. The journey record records what the journey did and what
the real kits answered; every lifecycle boundary (approve, activate)
REOPENS the real DH-01 kit from its OWN append-only ledger
(`loadHarnessKit`), re-reads the authority's own state and advances
through the authority's own surface. A post-journey lifecycle move
(a retirement, say) happens in the real kit and NEVER re-brokers the
journey evidence. A non-persistent journey would be a second
in-memory lifecycle authority — exactly what 12.6 forbids — so this
family requires the fsPort/root pair (THE PERSISTENCE-FIRST LAW, the
one deliberate departure from the sibling families' optional
persistence).

## THE FAIL-CLOSED LAW (the registry row's core law)

**An incomplete or unsafe proposal NEVER activates.** Every unsafe
condition is a typed refusal that leaves the REAL harness record at
its pre-refusal state (the record-unchanged law, pinned
byte-identical after every refusal in the battery); there is NO code
path from an unsafe proposal to an active harness. The typed
refusals, each named after the REAL law it enforces:

| refusal | the real law |
| --- | --- |
| `dangling-ref-at-proposal` | the REAL DH-01 draft->proposed full-validation boundary refused (a ref does not resolve in the catalog snapshot) — the real refusal carried verbatim, the record stays at draft |
| `catalog-binding-refused` | the REAL approve boundary refused — a capabilityRef ABSENT from the catalog snapshot (fail-closed escalation) |
| `unapproved-capability` | the REAL approve boundary refused — a capabilityRef below approved/enabled/available (a harness is NEVER approved over an unapproved capability) |
| `incomplete-composition` | the proposal boundary requires EVERY composition leg walked (the roles, the six record families, the binding draft) |
| `approval-missing` | THE APPROVAL-BEFORE-ACTIVATION LAW — no approval input, no activation |
| `unsafe-proposal` | the fail-closed double-check: the REAL harness record does not sit at `approved` at the activation boundary (an external actor's advance of the real record refuses the journey's activation — the authority's own state is the truth) |
| `malformed-decision` | the REAL DH-01 kit refused the caller-supplied decision shape |
| `malformed-catalog` | a malformed catalog snapshot resolves nothing (the journey never asks a malformed authority anything) |

## THE MULTI-ROLE LAW

One user, multiple roles/specializations: the journey composes the
roles through the REAL DH-03 role-composition family (its floors,
its `MAX_ROLES` (32) bound, its entry walk — never re-implemented).
The caller supplies the roles (never invented here); the journey
pins the 3-role happy path (the crown), the single-role floor and
the max-32 boundary surfaced verbatim (`max-roles-exceeded` carried
complete through the verbatim-carry surface).

## The approval-before-activation law

The caller-supplied approval decision is REQUIRED at the approve
boundary (no approval input, no activation). The decision is
RECORDED in the journey evidence — the real kit's own canonical
decision record, mirrored — never brokered: the REAL DH-01 kit's own
decision walk is the authority, the journey's mirror is the evidence
shape (`{ approvedBy, note? }` / `{ activatedBy }`).

## The journey leg map

The journey record's stages MIRROR the real DH-01 lifecycle at the
journey level (`selection -> composed -> proposed -> approved ->
active`, `active` TERMINAL — the post-activation lifecycle, retirement
included, belongs to the REAL DH-01 kit alone), walked through the
NINE frozen journey legs in the registry row's order:

| leg | op (the kit surface) | drives | stage |
| --- | --- | --- | --- |
| `industry-selection` | `selectIndustry` | the REAL DH-02 walk | selection |
| `company-composition` | `composeCompany` | the REAL DH-02 walk | selection |
| `work-type-selection` | `selectWorkTypes` | the REAL DH-02 walk | selection |
| `role-composition` | `composeRoles` | the REAL DH-03 kit (begin/add/finalize) | composed |
| `record-composition` | `composeRecords` | the REAL DH-02 `composeDraft` (the binding draft) + the REAL DH-04..DH-09 kits | composed |
| `proposal` + `validation` | `proposeHarness` (the two-leg op) | the real kits' emitted refs + the REAL DH-02 `composeDraft`/`proposeSession` (the FULL `validateDomainHarnessDescriptor` boundary fires THERE) | proposed |
| `approval` | `approveHarness` | the REAL DH-01 `advanceHarness(approved)` (the catalog binding law) | approved |
| `activation` | `activateHarness` | the REAL DH-01 `advanceHarness(active)` | active |

THE LINEAGE LAW: the record-composition leg mints a BINDING draft
(the composed roles with empty ref families — THE TWO-PHASE LAW: the
refs compose gradually); the proposal leg re-composes the FULL
composition (the emitted refs) which mints the FINAL harness — a NEW
harness id per the registry lineage law (an immutable descriptor is
never re-written; a re-composition is a re-mint, the real kits' own
law).

## THE VERBATIM-CARRY LAW

Every leg's typed refusal names the leg (`leg`) AND carries the
underlying real kit's refusal complete, never paraphrased:
`onboardingRefusal` (the REAL DH-02 refusal, which itself carries
the DH-01 refusal at its harness boundaries), `rolesRefusal` (the
REAL DH-03 refusal), `recordRefusal` (one of the REAL DH-04..DH-09
refusals), `harnessRefusal` (the REAL DH-01 refusal), and
`contentRejection` (the contract-level record-content walk, itself
carrying the owning family's COMPLETE typed rejection table).

## The persistence mirror (the PIN-2 pattern)

The journey evidence mirror lands under the same `.flauz/harness`
subtree at its own distinct files: the append-only ops ledger
`.flauz/harness/activation-ops.jsonl` (one canonical JSON line per
applied op; the seq equals the line number; the propose line carries
the full review composition — the proposal leg's evidence — and the
REAL full-green validation outcome — the validation leg's evidence)
and the envelope `.flauz/harness/activation-journeys.json` (
`{ contractVersion, seq, journeys }`). The ledger is authoritative;
`loadActivationKit` replays it and re-proves the journey laws FROM
THE LEDGER ALONE (the frozen line schema, the op<->leg table, the
stage chain through the contract's own machine, the payload walks
through the REAL family validators, THE INCOMPLETE-COMPOSITION LAW,
THE APPROVAL-BEFORE-ACTIVATION LAW), cross-checks the envelope
byte-for-byte (`E_LEDGER_TORN` / `E_ENVELOPE_MISMATCH` — never
silently rebuilt), and reopens the REAL DH-02 onboarding kit through
its own `loadOnboardingKit` (which reopens the REAL DH-01 kit
inside). Lazy persistence; a fresh kit never appends over an
existing non-empty activation ledger; restart-deterministic (the
reload reproduces the journey state byte-for-byte and the walk
continues through the reopened real kits).

## THE CONTENT LAW (this wave's honesty)

**No per-industry journey content is shipped.** This family is the
INSTRUMENT, not domain content: the caller supplies the selections
(the industry, the company profile, the work types, the roles) and
the domain content (the six record families' entries); the journey
routes them through the real kits and never invents an entry. The
evidence level is fixture: the journey battery drives the REAL kits
with fixture inputs — claim exactly that; nothing here is promoted
above fixture, no env is read, no secrets, no live authorities.

## The battery

| suite | file | passing |
| --- | --- | --- |
| activation contract | `test/common/activationContract.test.ts` | 92 |
| activation kit | `test/common/activationKit.test.ts` | 63 |
| **family total** | `test/common/*.test.ts` | **155** |

The crown: the COMPLETE journey happy path through the real kits —
begin -> selectIndustry -> composeCompany -> selectWorkTypes ->
composeRoles (THREE roles) -> composeRecords (real ontology terms, a
real template with termRefs resolving, real bodies with roleRefs
resolving, real packs with bodyRefs resolving, real profiles, a real
benchmark with REAL scenario refs) -> proposeHarness -> approveHarness
-> activateHarness — with the REAL harness record re-read from the
authority's own ledger at `active` and the descriptor carrying the
three composed roles. Every fail-closed branch is pinned (the table
above), the record-unchanged law byte-identical after every refusal,
the multi-role pins (3-role path, single-role floor, the REAL
max-32), the lifecycle-constraint pins (the frozen leg order,
`active` terminal), the persistence mirror (write / reload / replay
/ torn ledger / tampered line / divergent envelope / restart
determinism / the fail-closed laws re-proven from the ledger alone),
the serialization round-trip + fail-closed parse, and the determinism
greps (law-comment lines only).

Run recipes (the landed family recipe; the toolchain is preinstalled
— `tsc` at `~/toolchain/node_modules/.bin/tsc`, mocha via
`bunx --bun mocha`):

```sh
~/toolchain/node_modules/.bin/tsc -p build/flauz/harness/activation/tsconfig.json --noEmit
bunx --bun mocha --ui tdd 'build/flauz/harness/activation/test/common/*.test.ts'
grep -nE "Date\.now|Math\.random|new Date\(|process\.env" build/flauz/harness/activation/common/*.ts   # law-comment lines only
```
