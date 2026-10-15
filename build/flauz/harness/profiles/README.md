# DH-008 · the policy/approval/evidence/KPI profiles family (`build/flauz/harness/profiles/`)

SPEC-first charter (registry row DH-008, "domain
policy/approval/evidence/KPI profiles"; ARCHITECTURE-LOCK 12.5: a
harness may compose "policies/approvals, evidence requirements,
KPIs" — a harness over the universal Flauz core, never a fork). A
harness is domain-specific through its industry label (DH-01), its
onboarding record (DH-02), its named roles (DH-03), its domain terms
(DH-04), its task/workflow templates (DH-05), its organization's
default agent bodies (DH-06) and its default capability packs (DH-07)
— and through its **policy / approval / evidence / KPI profiles**:
the named default profiles that scope which permissions the domain's
work runs under, which risk tiers its approvals gate, which evidence
floor its work must clear and which KPI dimensions it is judged on.
This family is the DOMAIN-SIDE DEFAULTS layer for those profiles: a
typed, staged, deterministic `ProfilesRecord` family bound to a
harness, composing profile entries (configuration only), with the
family's validation, serialization and persistence laws. It composes
over the landed families and the REAL authority vocabularies — the
harness-id alphabet, the staged-session architecture, the ZC-006
catalog permission table and risk tiers, the Lab evidence ladder and
eval dimensions are imported from the real modules, never
re-implemented (THE IMPORT LAW).

## THE NO-NEW-AUTHORITY LAW (ARCHITECTURE-LOCK 12.6)

This family declares **defaults that REFERENCE the
permission/approval/evidence authorities — it grants no permission,
brokers no approval, leads no evidence, schedules nothing, executes
nothing**. The permission vocabulary is the REAL ZC-006 capability
catalog's (`build/flauz/capabilities/packs/common/catalog.ts`:
`CATALOG_PERMISSION_IDS`, `isCatalogPermissionId`); the
approval-tier vocabulary is that same catalog's REAL
`CATALOG_PERMISSION_RISK_TIERS`; the evidence ladder is the REAL Lab
`LabEvidenceLevel` (`build/flauz/lab/common/labContracts.ts`, the
imported type — its runtime membership table here is a pinned
type-exhaustive mirror that fails compilation on any drift); the KPI
dimensions are the REAL Lab `EvalDimension`. The kit injects NO
catalog and NO authority of any kind — the options carry only the
clock, the rng and the optional fs port/root pair, and the
vocabularies are the imported real modules, deterministic by
construction. A profile is TYPED CONFIGURATION over those
vocabularies; a second permission broker, approval engine, evidence
ledger, scheduler, journal, model router, resource registry or
persistence authority is forbidden here.

## THE CONTENT LAW (this wave's honesty)

**No per-industry profile content is shipped.** This wave ships the
LAYER, the machinery — not domain content. The registry's DH-002
precedent ("industry templates are LATER waves — do not invent
them") applies verbatim to policy/approval/evidence/KPI profiles: an
invented legal / medical / finance policy vocabulary would be an
unsourced fork of domain truth. The caller composes the profiles;
this family never invents them.

## The profile laws

- A profile entry is CONFIGURATION: exactly
  `{ profileKey, summary, permissionRefs, approvalTiers,
  evidenceFloor, kpiDimensions }` (THE NO-FORK LAW — an extra key is
  the typed no-fork rejection; a profile grants NOTHING by itself).
- `profileKey`: non-empty, at most 64 chars, no leading/trailing
  whitespace, no control characters; unique within the record.
- `summary`: non-empty, at most 200 chars, no control characters.
- `permissionRefs`: a duplicate-free string array whose members
  satisfy the REAL `isCatalogPermissionId` predicate, MAY be empty
  (the honest-gap law: a profile MAY name zero permissions).
- `approvalTiers`: a duplicate-free array of REAL
  `CATALOG_PERMISSION_RISK_TIERS` members, MAY be empty.
- `evidenceFloor`: EXACTLY ONE member of the REAL `LabEvidenceLevel`
  ladder per profile (the domain's minimum evidence requirement —
  never overstated).
- `kpiDimensions`: a duplicate-free array of REAL `EvalDimension`
  members, MAY be empty (the honest gap: a profile MAY judge zero
  dimensions).
- At most `MAX_PROFILES` (64) profiles per record; at least one
  profile at finalize (the empty-profiles floor — the refusal fires
  at the boundary, never the record shape).

## The authority-binding law

Every vocabulary is IMPORTED, never transcribed (the battery pins the
imports referentially against the real modules and pins a live-table
consistency check — every key of the imported
`CATALOG_PERMISSION_TABLE` is a `CATALOG_PERMISSION_IDS` member, and
every tier a risk-tier member). Membership in the real vocabulary is
the only admissibility: a non-catalog permissionRef is the typed
`bad-permission-ref` refusal, a non-risk-tier approvalTier is
`bad-approval-tier` (the catalog's fact-tier `none` is NOT a risk
tier), a non-ladder evidenceFloor is `bad-evidence-floor`, a
non-member kpiDimension is `bad-kpi-dimension` — each station
naming every offending item once, in first-seen order, with the
complete rejection table in the frozen twenty-four-station walk
order. `finalizeProfiles` re-proves the complete walk at the
boundary (every vocabulary re-proven against the REAL imported
tables), and the ledger replay re-proves it again from the ledger
alone (a tampered payload line is the typed `E_LEDGER_TORN`, never a
silent skip).

## The harness binding

The record binds to a harness through the REAL DH-01 harness-id
alphabet (`flauz:hrn:<16-hex>`, imported by reference — the FORM law,
enforced at `beginProfiles` and in the record walk). The EXISTENCE
binding is the caller's wiring, never this layer's; the cross-kit
integration pins bind it end-to-end through the real DH-01 kit.

## The staged model + the append-only lineage law

`composing -> composed`; `composed` is TERMINAL (THE APPEND-ONLY
LINEAGE LAW — a changed profile is a NEW profile, never a mutation
of a composed one; every mutating op on a composed record refuses
with the typed stale-stage refusal). A profile's key is its identity
(THE REMOVE+RE-ADD LAW): `replaceProfileSummary` replaces only the
summary — the permissionRefs, approvalTiers, evidenceFloor and
kpiDimensions are immutable once added; a changed profileKey is a
new profile (remove, then re-add); removing the last profile is
legal while composing. `emitPolicyRef` / `emitEvidenceRef` emit the
composed record's id as the policyRef / evidenceRef strings — pure
reads, only from a COMPOSED record. The emitted references ride the
DH-02 review composition's `policyRefs` / `evidenceRefs` families
(strings, duplicate-free per family): the landed DH-02 surface
carries exactly four ref families
(`capabilityRefs / workflowRefs / policyRefs / evidenceRefs`), and
the policy/evidence slots are where the domain's default profiles
bind into the review composition.

## The persistence model (the PIN-2 mirror)

The append-only ops ledger `.flauz/harness/profiles-ops.jsonl` (one
canonical JSON line per applied op; the seq equals the line number;
begin and finalize lines carry a null payload — no injected
authority) and the envelope `.flauz/harness/profiles-records.json`
(`{ contractVersion, seq, records }`). The ledger is authoritative;
`loadProfilesKit` replays it (every line re-validated: the frozen
eleven-key schema, the REAL harness-id alphabet on every line, the
op's stage edge, the payload's full vocabulary walk, the replace
line's immutable-parts cross-check, the remove line's
entry-as-it-stood cross-check, the finalize floor AND the finalize
complete-table walk) and cross-checks the envelope byte-for-byte
(`E_LEDGER_TORN` / `E_ENVELOPE_MISMATCH` — never silently rebuilt; a
version-bearing surface carrying another contract version is the
typed version-mismatch — the five-key record carries no version
field). Lazy persistence; a fresh kit never appends over a non-empty
ledger; restart-deterministic. The canonical serialization is
fixed-key-order bytes with the profile entries sorted
deterministically by profileKey, and the fail-closed parse refuses
non-canonical bytes (`non-canonical`) — never a silent
normalization.

## The battery

| suite | file | passing |
| --- | --- | --- |
| profiles contract | `test/common/profilesContract.test.ts` | 86 |
| profiles kit | `test/common/profilesKit.test.ts` | 70 |
| **family total** | `test/common/*.test.ts` | **156** |

Run recipes (the landed family recipe; bun is preinstalled):

```sh
NODE_OPTIONS=--max-old-space-size=2048 <tsc> -p build/flauz/harness/profiles/tsconfig.json --noEmit
bunx --bun mocha --ui tdd 'build/flauz/harness/profiles/test/common/*.test.ts'
grep -nE "Date\.now|Math\.random|new Date\(|process\.env" build/flauz/harness/profiles/common/*.ts   # law-comment lines only
```
