<!-- ---------------------------------------------------------------- -->
<!-- Flauz Capability Exchange - CR-006 registry runtime (B2, wave 1) -->
<!-- MIT License - see state.mjs for the full header box.             -->
<!-- Copyright (c) Flauz contributors.                                -->
<!-- ---------------------------------------------------------------- -->

# CR-006 Capability Exchange registry runtime

A persisted, restart-recoverable, fail-closed capability registry over
the ZC-006 pack contracts and the ZC-007 source-adapter contracts.
This is B2's early interface publication: B1, B3, and the CR-007/008
waves build ON TOP of this runtime, never beside it.

## The lifecycle (eight frozen states, never collapsed)

	discovered -> imported -> verified -> approved -> enabled
	                                                   |
	                                   (runtime projection)
	                                       v         v
	                                   available  unavailable
	                                   (recovery)     |
	                                                  v
	any state -> revoked (terminal)             revoked

- discovered: a source adapter surfaced a DiscoveredArtifact. Metadata
  only. NOTHING is trusted.
- imported: the ZC-007 forward-only import chain completed. Entries
  ALWAYS enter unverified.
- verified: a verification receipt landed and derived `verified`.
  `verified-partial` is recorded and does NOT advance.
- approved: the approval decision is recorded (who/when/scope/
  declared-permissions-acknowledged). CR-008 wires the real permission
  gate onto this decision shape.
- enabled: the operator act. Executable through the Flauz authorities.
- available / unavailable: the runtime's derived projection of an
  enabled entry (platform match + dependency presence). Runtime
  recovery between them needs NO re-approval, and is granted only for
  runtime-projected causes (platform-mismatch, dependency-missing).
- unavailable (verification-failed, disabled-by-operator) and revoked:
  no runtime recovery. Recovery is the new-version lineage (update).

## THE STABLE INTERFACE TABLE (for B1 / B3 / CR-007 / CR-008)

`createRegistry({ root, clock, fsPort, scope })` -> RegistryRuntime.
The clock and the fs port are INJECTED. Factory misuse throws
TypeError; every domain refusal is a typed record
`{ code, law, entryId, state, detail }` - never a string throw, never
a silent skip. The frozen refusal table lives in state.mjs.

| # | operation | signature | law |
|---|-----------|-----------|-----|
| 1 | discover | discover(discovery) -> entry in `discovered` | idempotent on content hash; repeat = typed disclosure D_DISCOVER_DUPLICATE |
| 2 | inspect | inspect(entryId) -> full honest record | state, discovery, imported data, provenance, receipts, approval, revocation, transitions, lineage |
| 3 | compare | compare(entryA, entryB) -> typed diff | version/digest/license/permissions/endpoints/platforms |
| 4 | verify | verify(entryId, receipt) | advances only from `imported`; `verified` -> verified, `verification-failed` -> unavailable, `verified-partial` recorded without advancing |
| 5 | approve | approve(entryId, decision) | refuses unless `verified`; decision must acknowledge the declared permissions exactly |
| 6 | register | register(importedEntry) | the ZC-007 import landing; canImport guard fails closed with the violation NAMED |
| 7 | enable | enable(entryId) | refuses unless `approved`; the discover-to-install-to-auto-trust path is FORBIDDEN |
| 8 | disable | disable(entryId, reason?) | applies to enabled/available; lands `unavailable` (disabled-by-operator) |
| 9 | update | update(entryId, newEntry) | the drift law: same version + different hash refuses; a new version creates a fresh lineage entry, never in-place mutation |
| 10 | remove | remove(entryId, reason?) | the typed revoke; `revoked` is terminal |
| 11 | query | query(predicate) | by state / artifactKind / platform / permissionTier; unknown fields or values fail closed; stable ordering by entryId |

Plus two non-operations of the stable eleven:

- load(): journal replay then snapshot cross-check; a torn or missing
  journal line fails closed with E_JOURNAL_TORN.
- projectAvailability(entryId, { platformMatch, dependenciesPresent }):
  the RUNTIME-AVAILABILITY PORT. The one reserved hook for the runtime
  authority (ruling 1's projection edges). Journaled and routed through
  the pure machine exactly like every mutating operation.

## Persistence and restart recovery

- `registry-journal.jsonl`: append-only, one record per line, every
  record carrying `scope {workspaceId, tenantId}` and
  `contractVersion`. The journal is authoritative.
- `registry-state.json`: snapshot rewritten after each op. Absent or
  stale -> rebuilt byte-identically from replay (D_SNAPSHOT_REBUILT).
  Unparseable, or equal-sequence but divergent -> E_SNAPSHOT_MISMATCH.
  Snapshot sequence greater than journal lines -> E_JOURNAL_TORN
  (missing journal lines; never a silent skip).
- Restart: `createRegistry(...)` then `load()` rebuilds the identical
  state; the replay drill proves byte-identical snapshots.
- Determinism: canonical JSON, sha256 over canonical bytes, injected
  clock, deterministic entry ids. No wall-clock or randomness
  primitives anywhere in the runtime.

## Vocabulary cross-pins

state.mjs carries frozen copies of the ZC-006/007 vocabularies
(artifact kinds, permission ids, risk tiers, platforms, verification
statuses, the nine source kinds, the import chain). The test battery
imports the contract modules directly and pins both-directional list
equality. If disk and runtime ever diverge, the suite fails closed.

## Not a second authority

The registry records capability IDENTITY, lifecycle, and verification
receipts. It does not schedule, execute, broker permissions, or rank.
Execution stays with the existing Tool/Resource authorities; approval
policy with the approval authority (CR-008 wires the real gate onto
the decision shape recorded here).

## Files

- state.mjs / state.d.mts: the pure machine, frozen vocabularies, the
  frozen refusal and disclosure tables.
- registry.mjs / registry.d.mts: the persisted runtime and THE stable
  interface.
- registry.test.ts: the mocha tdd battery.
- tsconfig.json: the scoped test-program posture.