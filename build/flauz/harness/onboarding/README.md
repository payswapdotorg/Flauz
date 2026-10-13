# DH-002 onboarding family

The typed staged-session instrument for the Domain Harness OS
direction (WORK-REGISTRY.md § TL-B, item 2/13): the onboarding session
that walks a user from industry selection through company-profile
composition to work-type selection, assembles the harness descriptor
draft at the review stage, and mints + proposes it THROUGH THE REAL
DH-001 kit (`build/flauz/harness/contract/**`, never re-implemented).
A harness is **composable configuration over the universal Flauz
core, NOT an industry-specific fork** — the onboarding family is a
flow state machine + descriptor assembly over the landed contract
layer. The post-proposal harness lifecycle (approved / active /
retired) belongs to the DH-001 kit, never this family's.

## 1. The SPEC (the design record)

### The surface inventory

```
build/flauz/harness/onboarding/
  common/
    onboardingContract.ts   the pure contract module (no fs, no clock calls, no kit):
                            the frozen stage machine (5 stages, 4 forward rows, the
                            verdict matrix), the frozen company size bands (5), the
                            frozen schema tables (company profile: 2 keys; review
                            composition: 5 keys; session record: 11 keys; history
                            note: 6 keys; ledger line: 11 keys; envelope: 3 keys),
                            the frozen rejection vocabulary (22) and parse vocabulary
                            (5), the four stage-payload validators + the deep session
                            walk (first-failure in the frozen walk order), the DH-01
                            vocabularies imported and re-exported BY REFERENCE, the
                            canonical fixed-key-order serialization, the fail-closed
                            parse
    onboardingKit.ts        the deterministic kit over the REAL DH-01 kit: constructs
                            createHarnessKit / reopens loadHarnessKit internally with
                            the same injected seams (clock, rng, catalog, fsPort,
                            root) forwarded verbatim; beginSession / selectIndustry /
                            composeCompany / selectWorkTypes / composeDraft /
                            proposeSession / inspectSession / listSessions / dispose /
                            loadOnboardingKit, all async with typed outcomes
  test/
    common/
      onboardingContract.test.ts   the contract battery (84 tests)
      onboardingKit.test.ts        the kit battery (74 tests)
  tsconfig.json             byte-parity with build/flauz/harness/contract/tsconfig.json
  README.md                 this file
```

### The refusal taxonomy

Every domain refusal is the typed record
`{ ok: false, refusal: { reason, law, message, items? } }` — never a
string throw, never a silent skip, never a partial effect. The
contract's frozen list `ONBOARDING_VALIDATION_REJECTION_REASONS`
(22, the exact walk order):

```
malformed-record, no-fork, unknown-key, missing-key, unknown-session,
version-mismatch, unknown-industry, invalid-display-name,
unknown-size-band, empty-work-types, unknown-work-type,
duplicate-work-types, work-types-out-of-order, premature-op,
stale-stage, empty-roles, malformed-role, duplicate-role-keys,
malformed-refs, duplicate-ref, harness-kit-refused, disposed
```

The validation walk is **first-failure-is-the-verdict** in this
order: `malformed-record` (the candidate is not a plain object, or a
PRESENT field/carrier carries the wrong structural type — an absent
key is the `missing-key` station, never a structural one), `no-fork`
(the forbidden-key family on the payload record, fired BEFORE
`unknown-key` per the DH-01 precedence law, plus the extra keys on
role entries — the DH-01 station (c)), `unknown-key`, `missing-key`,
then the field stations. The kit layer completes the taxonomy at the
op boundary with the frozen extras `E_LEDGER_TORN`,
`E_ENVELOPE_MISMATCH`, `ONBOARDING_IO`, `CORRUPT_SEAM`,
`UNKNOWN_FILTER` (`ONBOARDING_KIT_REFUSAL_REASONS` = the 22 + the 5),
and adds the `harnessRefusal` carrier: a refused mint / advance /
reopen surfaces the DH-01 kit's own refusal **verbatim** (the
battery pins it byte-identical against a direct DH-01 kit call).

The op-entry guard order (documented, deterministic): `disposed` →
`unknown-session` (a malformed id fails closed as unknown, the DH-01
NOT_FOUND discipline) → the stage guard (`premature-op` when the
walk is behind the op's stage — or the review stage holds no minted
draft for `proposeSession`; `stale-stage` when the walk is past it) →
the payload walk (the contract's typed refusal surfaced verbatim) →
the real-kit boundary (`harness-kit-refused`).

### The stage machine

```
industry -> company -> work-types -> review -> proposed
                                               (terminal for the
                                                onboarding session)
```

- `ONBOARDING_FORWARD_TRANSITIONS`: exactly the four rows above
  (`canTransitionOnboardingStage` is the pure verdict machine:
  skips, backwards moves, self-loops and `proposed->anything` are
  the typed ILLEGAL_TRANSITION verdict naming the violated row).
- `beginSession` mints `flauz:onb:<16-hex>` from the injected rng and
  lands at `industry`; each stage op validates its payload and
  advances; the walk NEVER moves back; a changed session is a NEW
  session (the onboarding lineage law).
- `composeDraft` is the review stage's own op: it validates the
  caller-supplied composition (roles + the four ref families —
  **supplied by the caller, never invented; role/ontology invention
  is DH-003's item**), assembles the DH-01 descriptor spec from the
  session state (industry, workTypes, the company profile's
  displayName, roles + the four ref families — the harnessId and the
  contractVersion are the real kit's own minted keys), mints it
  through `inner.mintHarness`, and records the harness link. The
  session STAYS at `review` (the stage does not move; a failed mint
  is `harness-kit-refused`, the session unchanged).
- `composeDraft` is re-callable at review: each re-composition mints
  a NEW harness id through the real kit (the registry lineage law);
  the replaced draft remains in the harness ledger as honest orphan
  history. This is the recovery path after a refused propose.
- `proposeSession` requires the minted link and calls
  `inner.advanceHarness(harnessId, 'proposed')` — the
  NO-DANGLING-REF boundary fires THERE against the injected catalog
  snapshot; on ok the session advances `review -> proposed`
  (TERMINAL for the onboarding walk).
- The company displayName bound is **120** characters (this family's
  own law); the DH-01 descriptor's bound is **80** (frozen, landed).
  A 81–120 character name composes fine and is then refused at the
  mint boundary by the REAL kit (`harness-kit-refused` carrying the
  DH-01 `invalid-display-name` verbatim) — the onboarding family
  never relaxes the core's law, never truncates silently.

### The persistence model

The same `.flauz/harness` subtree as DH-01, distinct files:
`.flauz/harness/onboarding-ops.jsonl` (the append-only ops ledger)
and `.flauz/harness/onboarding-sessions.json` (the envelope
`{ contractVersion, seq, sessions }`, sessions sorted by sessionId,
each the canonical fixed-key-order session bytes). One canonical
JSON line per applied op; the seq is strictly increasing and equals
the line number; the envelope is rewritten after each append. The
**inner real kit persists its OWN files through the SAME injected
fsPort + root** (`.flauz/harness/harness-ops.jsonl` +
`harnesses.json`) — at `composeDraft` the real kit's mint lands
FIRST (the DH-01 authority), the onboarding line lands second: an
orphan draft after a torn onboarding append is honest history, never
data loss, and the session never references a harness that was not
minted. `loadOnboardingKit` replays the onboarding ledger (the
authoritative surface — each line re-validated: the op's stage edge,
the session's walk order, the payload's full validation, the harness
link's shape), cross-checks the envelope byte-for-byte (a torn or
missing line is the typed `E_LEDGER_TORN`; a divergent envelope is
the typed `E_ENVELOPE_MISMATCH`, never silently rebuilt), and then
reopens the inner real kit through `loadHarnessKit` (a refused inner
reopen is `harness-kit-refused` carrying the DH-01 refusal verbatim).
A fresh `createOnboardingKit` never appends over an existing
non-empty onboarding ledger — reopen with `loadOnboardingKit`. The
two ledgers are independently authoritative for their own families
(the harness ledger is the DH-001 kit's; the onboarding ledger is
this family's); a restart mid-walk re-derives both and a reloaded
kit completes the walk (the battery pins it).

## The binding laws (inherited from the DH-001 landed family)

1. **THE NO-FORK LAW** — inherited through the DH-01 descriptor
   mint: the onboarding alphabet is references and configuration
   only. The forbidden-key family (imported by reference from the
   DH-01 contract) is rejected with the typed `no-fork` refusal
   BEFORE `unknown-key`; role entries carry only `roleKey` +
   `summary`; the composed draft can never carry execution material
   (the real kit's own mint boundary re-enforces the law — never
   relaxed here).

2. **THE FORWARD-ONLY LAW** — the onboarding stage machine never
   walks back; `proposed` is TERMINAL for the onboarding session
   (the post-proposal lifecycle is the DH-001 kit's); a changed
   session is a NEW session. `premature-op` / `stale-stage` are the
   typed stage refusals.

3. **THE TWO-PHASE LAW** — dangling refs mint fine at draft (the
   review composition composes gradually); resolution is enforced at
   the propose boundary THROUGH the real kit's own
   NO-DANGLING-REF check against the injected catalog snapshot.

4. **THE REAL-KIT LAW** — the mint and the draft->proposed advance
   are ALWAYS the DH-01 kit's own operations: `createOnboardingKit`
   constructs `createHarnessKit({ clock, rng, catalog, fsPort,
   root })` and `loadOnboardingKit` reopens `loadHarnessKit` with
   the same seams forwarded verbatim — imported, constructed,
   never re-implemented, never bypassed. (The factory consumes two
   seam reads — one per factory validation; the battery accounts for
   them.)

5. **THE DETERMINISM LAW** — no `Math.random`, no `Date.now`, no
   `new Date(...)`, no `process.env` in the shipped modules (law
   comments excepted; the battery greps pin this). The clock, the
   rng, the catalog and the fsPort are INJECTED seams; the persisted
   bytes are canonical fixed-key-order JSON (the DH-01 algorithm:
   the frozen per-shape key orders applied deeply, never an
   alphabetic re-sort); restart determinism is pinned byte-for-byte.

6. **THE FAIL-CLOSED LAW** — factory misuse throws `TypeError`
   (every precondition checked with the exact DH-01 message shape);
   every domain refusal is the typed record naming the violated law
   and the offending items; no silent partial effects (a refused op
   leaves the session unchanged — inspectable before and after).

7. **THE SINGLE-VERSION LAW** — `ONBOARDING_CONTRACTS_VERSION` is
   `'1.0.0'` declared ONCE in the contract module, re-carried by the
   kit (the re-export); the battery pins both copies equal, and the
   DH-01 vocabularies are re-exported BY REFERENCE (the same
   bindings — `HARNESS_INDUSTRIES`, `HARNESS_WORK_TYPES`, their
   predicates, the forbidden-key family — never re-declared).

8. **THE APPEND-ONLY LEDGER LAW** — as the persistence model above:
   one canonical line per applied op (the seq equals the line
   number), the ledger authoritative, the envelope cross-checked
   byte-for-byte at load, `E_LEDGER_TORN` / `E_ENVELOPE_MISMATCH`
   never silently rebuilt, a fresh kit never appending over an
   existing ledger.

## The frozen vocabularies

- `ONBOARDING_CONTRACTS_VERSION = '1.0.0'`
- `ONBOARDING_SESSION_ID_PREFIX = 'flauz:onb:'`
- `ONBOARDING_STAGES = ['industry', 'company', 'work-types', 'review', 'proposed']`
- `ONBOARDING_FORWARD_TRANSITIONS`: `industry->company`,
  `company->work-types`, `work-types->review`, `review->proposed`
- `COMPANY_SIZE_BANDS = ['solo', 'small', 'medium', 'large', 'enterprise']`
- `COMPANY_PROFILE_SCHEMA_KEYS = ['displayName', 'sizeBand']`
  (displayName: non-empty, ≤120 chars, no control characters
  C0/DEL/C1; sizeBand: a frozen band member)
- `ONBOARDING_REVIEW_COMPOSITION_SCHEMA_KEYS = ['roles',
  'capabilityRefs', 'workflowRefs', 'policyRefs', 'evidenceRefs']`
  (roles: non-empty, the DH-01 `{ roleKey, summary }` shape, unique
  roleKeys, supplied by the caller — role invention is DH-003's
  item; the four ref families: string arrays, duplicate-free, MAY be
  empty)
- `ONBOARDING_OP_NAMES = ['begin-session', 'select-industry',
  'compose-company', 'select-work-types', 'compose-draft',
  'propose-session']`
- `ONBOARDING_SESSION_SCHEMA_KEYS` (11): `sessionId,
  contractVersion, stage, industry, companyProfile, workTypes,
  reviewComposition, harnessId, createdAtIso, revision, history`
- `ONBOARDING_VALIDATION_REJECTION_REASONS` (22): the refusal
  taxonomy above
- `ONBOARDING_PARSE_REJECTION_REASONS` (5): `malformed-json,
  torn-envelope, unknown-contract-version, unknown-key,
  invalid-record`
- `ONBOARDING_KIT_EXTRA_REFUSAL_REASONS` (5): `E_LEDGER_TORN,
  E_ENVELOPE_MISMATCH, ONBOARDING_IO, CORRUPT_SEAM, UNKNOWN_FILTER`
- The DH-01 vocabularies (`HARNESS_INDUSTRIES` 16,
  `HARNESS_WORK_TYPES` 10, `FORBIDDEN_HARNESS_DESCRIPTOR_KEYS` 10)
  — imported and re-exported by reference, never re-declared

## The battery

| receipt | command | expected |
|---|---|---|
| onboarding battery (contract) | `bunx --bun mocha --ui tdd 'build/flauz/harness/onboarding/test/common/onboardingContract.test.ts'` | 84 passing, 0 failing |
| onboarding battery (kit) | `bunx --bun mocha --ui tdd 'build/flauz/harness/onboarding/test/common/onboardingKit.test.ts'` | 74 passing, 0 failing |
| onboarding battery (full) | `bunx --bun mocha --ui tdd 'build/flauz/harness/onboarding/test/common/*.test.ts'` | 158 passing, 0 failing |
| type check | `npx tsc -p build/flauz/harness/onboarding` | EXIT 0 (noEmit in the tsconfig) |
| determinism greps | `grep -nE 'Date\.now\|new Date\|Math\.random\|process\.env' build/flauz/harness/onboarding/common/*.ts build/flauz/harness/onboarding/test/common/*.ts` | law-comment lines only (the shipped modules quote the ban in their law comments; the test sources assemble the patterns piecewise and carry zero hits) |
| tsconfig parity | `diff build/flauz/harness/contract/tsconfig.json build/flauz/harness/onboarding/tsconfig.json` | identical |
| sibling regression (contract) | `bunx --bun mocha --ui tdd 'build/flauz/harness/contract/test/common/*.test.ts'` | 181 passing, 0 failing |
| sibling regression (ops) | `bunx --bun mocha --ui tdd 'build/flauz/production/ops/test/common/*.test.ts'` | 137 passing, 0 failing |
