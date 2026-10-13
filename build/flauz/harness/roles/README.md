# DH-003 role-composition family

The typed multi-role user composition instrument for the Domain
Harness OS direction (WORK-REGISTRY.md, the wave-3 role-composition
family, registry row DH-003 "multi-role user composition"): where the
landed DH-002 onboarding kit REFUSED to invent roles (its
`composeDraft` takes a caller-supplied `OnboardingReviewComposition`
whose roles the onboarding contract explicitly defers — "the caller
supplies them - role invention is DH-003's item"), **this family is
that instrument**: a typed, staged, deterministic role-composition
session that composes the domain roles and emits the review
composition for the REAL DH-02 kit. Composition over the landed
families: the frozen vocabularies, the `HarnessRole` law, the
review-composition validator and the ref-family list are the LANDED
DH-01/DH-02 surfaces — imported from the real modules, never
re-declared, re-implemented or shadowed (**THE IMPORT LAW**, this
family's charter). A named role is CONFIGURATION (a roleKey plus a
human summary); it grants NOTHING by itself.

## 1. The SPEC (the design record)

### The surface inventory

```
build/flauz/harness/roles/
  common/
    rolesContract.ts   the pure contract module (no fs, no clock calls, no kit):
                       the frozen stage machine (composing -> composed, composed
                       TERMINAL), the frozen role laws (roleKey <=64 trimmed
                       no-control, summary <=200, MAX_ROLES 32, the
                       exactly-two-keys NO-FORK shape, unique roleKeys), the
                       FIVE-KEY session record, the frozen history-note shape,
                       the complete-table validation walk in the frozen station
                       order, the emit-input walk (roles + the four ref
                       families), the canonical fixed-key-order serialization +
                       the fail-closed parse, ROLES_CONTRACTS_VERSION '1.0.0'
    rolesKit.ts        the deterministic kit over the injected seams (clock,
                       rng, fsPort, root): beginSession / addRole /
                       replaceRoleSummary / removeRole / finalizeComposition /
                       emitReviewComposition / inspectSession / listSessions /
                       dispose / loadRolesKit, all async with typed outcomes;
                       the PIN-2-style persistence mirror
  test/
    common/
      rolesContract.test.ts   the contract battery (68 tests)
      rolesKit.test.ts        the kit battery (84 tests)
  tsconfig.json      byte-parity with build/flauz/harness/contract/tsconfig.json
  README.md          this file
```

### The refusal taxonomy

Every domain refusal is the typed record
`{ ok: false, mode: 'shape', rejections: readonly RoleCompositionRejection[] }`
with the COMPLETE table in the frozen walk order (never first-only) —
`ROLES_REJECTION_REASONS` (19; the fifteen work-order stations verbatim
in order, plus the four WO-authorized kit-layer extensions):

```
malformed-record, unknown-key, missing-key, unknown-industry,
malformed-role, no-fork, invalid-role-key, invalid-summary,
duplicate-role-key, max-roles-exceeded, empty-roles, unknown-session,
version-mismatch, unknown-stage, malformed-history,
premature-op, stale-stage, unknown-role, duplicate-ref
```

The absent-key discipline (the DH-01 law): an absent key is the
`missing-key` station, never a structural/field one — a field station
fires only on a PRESENT-but-invalid value. Empty roles are LEGAL in the
session shape (the `empty-roles` floor fires at finalize / emit, never
the walk). `version-mismatch` never fires on THE FIVE-KEY MODEL (the
session record carries no contractVersion; the single-version law is
enforced at the kit-layer persistence surfaces — every ledger line and
the envelope carry `ROLES_CONTRACTS_VERSION`).

### The stage machine

```
composing -> composed
             (TERMINAL — every mutating op on a composed session
              refuses with the stage law)
```

- `beginSession(industry)` mints `flauz:rol:<16-hex>` from the injected
  rng and lands at `composing`; the composition is industry-scoped (one
  REAL `HARNESS_INDUSTRIES` member — the session record binds it).
- `addRole` / `replaceRoleSummary` / `removeRole` are the
  composition-layer ops (the role laws; a role's key is its identity —
  immutable once added; THE REMOVE+RE-ADD LAW: a changed key is a NEW
  role). A typed refusal leaves the session unchanged.
- `finalizeComposition` is the boundary: at least one role (the DH-01
  floor), advances `composing -> composed` (TERMINAL).
- `emitReviewComposition(sessionId, refs?)` requires the composed
  stage; carries the composed roles VERBATIM and the four ref families
  defaulting EMPTY (THE HONEST-GAP LAW: the workflow / policy /
  evidence authorities are the DH-004 / DH-005 / DH-008 waves — the
  emit NEVER invents a non-empty ref). Every emitted composition passes
  the REAL `validateOnboardingReviewComposition` — pinned in both
  batteries; the cross-kit journey pins the minted descriptor's roles
  BYTE-IDENTICAL to the composed roles.

### The persistence model

The same `.flauz/harness` subtree as the landed families, distinct
files: `.flauz/harness/roles-ops.jsonl` (one canonical JSON line per
applied op; the seq is strictly increasing and equals the line number)
and `.flauz/harness/roles-sessions.json` (the envelope
`{ contractVersion, seq, sessions }`, sessions sorted by sessionId,
each the canonical fixed-key-order session bytes). The ledger line is
the TEN-KEY shape (no harnessId — this family mints no harness; the
harness link is the DH-02 propose boundary's business).
`loadRolesKit` replays the ledger (each line re-validated), cross-checks
the envelope byte-for-byte (a torn or missing line is the typed
`E_LEDGER_TORN`; a divergent envelope is the typed `E_ENVELOPE_MISMATCH`,
never silently rebuilt). A fresh `createRolesKit` never appends over an
existing non-empty ledger — reopen with `loadRolesKit`. The factory
consumes exactly ONE clock read and ONE rng read (a disclosed
divergence from the DH-02 doubled-read precedent, pinned by the
battery).

## The binding laws (inherited from the landed families)

1. **THE IMPORT LAW** (this family's charter) — every landed surface is
   imported from the real modules (`HARNESS_REF_FAMILIES`,
   `isHarnessIndustry`, `DOMAIN_HARNESS_CONTRACTS_VERSION`,
   `ONBOARDING_CONTRACTS_VERSION`, `validateOnboardingReviewComposition`,
   `HarnessFsPort`); zero re-declared vocabularies, zero shadowed
   validators; the batteries pin referential identity and
   both-directional verbatim equality.
2. **THE NO-FORK LAW** — role entries carry EXACTLY `{ roleKey, summary }`
   (an extra key is the typed `no-fork` refusal); a named role grants
   NOTHING by itself.
3. **THE FORWARD-ONLY LAW** — composing -> composed, composed TERMINAL;
   `premature-op` / `stale-stage` are the typed stage refusals.
4. **THE COMPLETE-TABLE LAW** — the validation walk reports every
   violated station in the frozen order, never first-only; a typed
   refusal leaves the session unchanged.
5. **THE DETERMINISM LAW** — no `Math.random`, no `Date.now`, no
   `new Date(...)`, no `process.env` in the shipped modules (law
   comments excepted; the battery greps pin this). The clock, the rng
   and the fsPort are INJECTED seams; the persisted bytes are canonical
   fixed-key-order JSON; restart determinism is pinned byte-for-byte.
6. **THE FAIL-CLOSED LAW** — factory misuse throws `TypeError`; every
   domain refusal is the typed record naming the violated law and the
   offending items.
7. **THE SINGLE-VERSION LAW** — `ROLES_CONTRACTS_VERSION = '1.0.0'`
   declared ONCE in the contract module, re-carried by the kit; the
   DH-01/DH-02 versions re-carried through the re-export chain; the
   batteries pin every copy equal.
8. **THE APPEND-ONLY LEDGER LAW** — as the persistence model above.

## The frozen vocabularies

- `ROLES_CONTRACTS_VERSION = '1.0.0'`
- `ROLE_COMPOSITION_ID_PREFIX = 'flauz:rol:'`
- `ROLE_COMPOSITION_STAGES = ['composing', 'composed']`
- `MAX_ROLES = 32`
- `ROLE_COMPOSITION_SESSION_SCHEMA_KEYS` (5): `sessionId, industry,
  stage, roles, history` (THE FIVE-KEY MODEL — no contractVersion field)
- `ROLE_COMPOSITION_NOTE_SCHEMA_KEYS` (6): `at, fromStage, toStage, op,
  law, detail`
- `ROLE_COMPOSITION_OP_NAMES` (5): `begin-session, add-role,
  replace-role-summary, remove-role, finalize-composition`
- `ROLES_REJECTION_REASONS` (19): the taxonomy above
- `ROLES_ENVELOPE_RELATIVE_PATH = '.flauz/harness/roles-sessions.json'`
- `ROLES_LEDGER_RELATIVE_PATH = '.flauz/harness/roles-ops.jsonl'`

## The battery

| receipt | command | expected |
|---|---|---|
| roles battery (contract) | `bunx --bun mocha --ui tdd 'build/flauz/harness/roles/test/common/rolesContract.test.ts'` | 68 passing, 0 failing |
| roles battery (kit) | `bunx --bun mocha --ui tdd 'build/flauz/harness/roles/test/common/rolesKit.test.ts'` | 84 passing, 0 failing |
| roles battery (full) | `bunx --bun mocha --ui tdd 'build/flauz/harness/roles/test/common/*.test.ts'` | 152 passing, 0 failing |
| type check | `npx tsc -p build/flauz/harness/roles` | EXIT 0 (noEmit in the tsconfig) |
| determinism greps | `grep -nE 'Date\.now\|new Date\|Math\.random\|process\.env' build/flauz/harness/roles/common/*.ts` | law-comment lines only |
| tsconfig parity | `diff build/flauz/harness/contract/tsconfig.json build/flauz/harness/roles/tsconfig.json` | identical |
| sibling regression (contract) | `bunx --bun mocha --ui tdd 'build/flauz/harness/contract/test/common/*.test.ts'` | 181 passing, 0 failing |
| sibling regression (onboarding) | `bunx --bun mocha --ui tdd 'build/flauz/harness/onboarding/test/common/*.test.ts'` | 158 passing, 0 failing |
| sibling regression (ops) | `bunx --bun mocha --ui tdd 'build/flauz/production/ops/test/common/*.test.ts'` | 137 passing, 0 failing |

## Provenance

The paste-protocol text-emission lane (chat 544a9b5c): the family was
authored through the station-supervised five-batch paste protocol and
emitted in-chat (the account's agent-workspace capability was degraded
to chat-scene/free mid-campaign). The station transcribed the emission,
independently re-ran every gate at the pinned base `b30db168df`, and
lands the family; the emission's receipts are claims, the station's
gates are the evidence. The README's narrative sections were completed
by the station from the landed tree after the emission stream truncated
mid-file (disclosed in the registry record).
