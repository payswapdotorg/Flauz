<!-- ---------------------------------------------------------------- -->
<!-- Flauz Capability Exchange - CR-008 verification + permission    -->
<!-- gate (B2, Phase C-R wave 3).                                     -->
<!-- MIT License - see gate.ts for the full header box.              -->
<!-- Copyright (c) Flauz contributors.                                -->
<!-- ---------------------------------------------------------------- -->

# CR-008 verification + permission gate

The runtime consumer that closes the missing middle between the
CR-007 import adapters and the CR-010b CLI reads: it takes verification
receipts and typed permission decisions and drives the CR-006
registry's own verify / approve / enable transitions with fail-closed
policy enforcement. NO capability reaches `enabled` without verified
status and an acknowledged permission decision.

## Not a second authority (the lane law)

The CR-006 registry IS the capability lifecycle authority: the eight
states, the eleven operations, the JSONL journal. This gate owns NO
lifecycle state, keeps NO shadow catalog, and writes NO second
journal. `createGate` constructs the REAL registry over the SAME root
- one journal, the registry's own - and every lifecycle change is a
registry operation call. The gate's own records are DECISION EVIDENCE
only (see Persistence).

## THE STABLE INTERFACE TABLE

`createGate({ root, clock, fsPort, scope })` -> Promise<GateRuntime>.
`loadGate(root, { clock, fsPort, scope })` is the restart seam: the
same construction, replaying the registry journal plus the gate
records. The clock and the fs port are INJECTED. Factory misuse
throws TypeError; every domain refusal is a typed `GateError` carrying
the violated law VERBATIM (frozen laws consumed from the registry's
own frozen tables; `source` discloses whether the registry or the
gate enforced it). Inputs are deliberately loose so invalid values
stay representable for the fail-closed tests.

| # | operation | law |
|---|-----------|-----|
| 1 | submitVerificationReceipt(entryId, receipt) | gate-strict receipt shape (a frozen verification status + a non-empty array of { checkId, verdict } checks), then drives registry.verify: `verified` -> verified, `verification-failed` -> unavailable (the machine derives the cause itself), `verified-partial` / `unverified` -> recorded without advancing (typed disclosures ride the outcome) |
| 2 | decidePermissions(entryId, decision) | evidence, not lifecycle: exact acknowledgement of the declared permissions (the registry's own computation, pre-checked so no registry call is attempted when the mismatch is provable from the read view); high-risk permissions require riskAcknowledged: true (E_HIGH_RISK_UNACKNOWLEDGED, gate-owned) |
| 3 | approve(entryId) | submits the latest recorded decision to registry.approve, re-validating it against the entry's CURRENT declared permissions first (fail-closed; no registry call on a provable mismatch) |
| 4 | enable(entryId) | drives registry.enable; a verified-partial receipt history is disclosed to the operator as a durable typed warning carrying the partial checks census (the enable path stays legal per the machine) |
| 5 | gatePolicySummary(entryId) | the read-only fail-closed policy projection: state, declared permissions + risk tiers, verification status + receipts/checks census, the registry's approval record, the gate's decisions and warnings. PURE READS - zero writes |

## Gate-owned vocabulary (disclosed; never promoted into the frozen tables)

- `E_HIGH_RISK_UNACKNOWLEDGED` - the ONE gate-owned refusal code: a
  permission decision acknowledging a high-risk permission
  (execute-command, network-access per the frozen ZC-006 catalog
  table) must carry `riskAcknowledged: true`.
- `W_ENABLE_VERIFICATION_PARTIAL` - the ONE gate-owned warning code:
  the durable operator disclosure when an entry with a
  verified-partial receipt history is enabled.
- `cr-008.1` - the gate records contract version.

Every other code the gate emits is a FROZEN registry code with its law
quoted verbatim: E_RECEIPT_MALFORMED, E_APPROVAL_MALFORMED,
E_APPROVAL_ACKNOWLEDGEMENT_MISMATCH, E_VERIFY_REQUIRES_IMPORTED,
E_APPROVE_REQUIRES_VERIFIED, E_ENABLE_REQUIRES_APPROVED,
E_ENTRY_UNKNOWN, E_REVOKED_TERMINAL, E_JOURNAL_TORN,
E_SNAPSHOT_MISMATCH, E_JOURNAL_UNLAWFUL. Gate-records replay failures
reuse the registry's journal laws verbatim (torn / missing /
out-of-order line -> E_JOURNAL_TORN; foreign scope or contract
version -> E_SNAPSHOT_MISMATCH; a record referencing an entry the
loaded registry does not know -> E_JOURNAL_UNLAWFUL).

## Vocabulary sourcing

The verification status vocabulary and the frozen refusal/disclosure
tables are IMPORTED from the registry (the stable B2 interface's
re-export of state.mjs) - never transcribed. The permission risk
tiers are transcribed from the frozen ZC-006 catalog
(packs/common/catalog.ts CATALOG_PERMISSION_TABLE) and cross-pinned
by the battery both against the pasted catalog table and behaviorally
against the registry's own query(permissionTier) view; they are
deliberately NOT sourced from state.mjs PERMISSION_TABLE, which is
self-marked DRAFTED, NOT DISK-PINNED.

## Persistence and restart recovery

- `<root>/.flauz/gate/records.jsonl`: append-only evidence records
  (receipts the gate submitted, permission decisions, durable
  warnings), every line carrying `scope { workspaceId, tenantId }` and
  contract version `cr-008.1`, canonical JSON, injected-clock
  timestamps. Evidence, never lifecycle state: the registry journal
  remains the ONLY lifecycle authority, and the registry snapshot the
  only state snapshot.
- Restart: `loadGate` replays the registry journal (the registry's own
  load + snapshot cross-check) and then the gate records under the
  same fail-closed journal laws.
- Live view: the gate holds ONE registry instance loaded at
  construction, mirroring the registry's one-journal-many-instances
  semantics. The journal is the truth; a restarted gate sees every
  record.
- Determinism: injected clock; canonical JSON via the registry's own
  serializer; deterministic content-derived entry ids; no wall-clock
  or randomness primitives anywhere in this subtree (the battery's
  temp roots are counter-derived).

## Files

- gate.ts: the gate runtime.
- gate.test.ts: the mocha tdd battery (local-real: a real registry
  over the real fs, injected clock; 69 tests).
- tsconfig.json: the scoped strict posture (the registry family
  pattern, include widened to the .ts family per the sources/adapters
  pattern).