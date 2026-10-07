# ZC-005 — Scoped Persistent Agent Memory Contracts (Phase C)

One versioned, zero-dependency contract set:
`SCOPED_MEMORY_CONTRACTS_VERSION = '1.0.0'`.

This subtree is the DEEP scoped-memory contract family of the
ZCode-derived patterns program: user/project/workspace-local agent memory
as REQUEST/READ-MODEL shapes and pure laws.

This subtree is a typed contract set ONLY. By law there is no memory
store, no persistence engine, no retrieval index, and no embedding surface
here; any runtime memory store is out of scope by law and belongs to the
Workspace OS layer. The contracts describe what such a store may persist,
what it must refuse, and how the records compose.

## Module index

- `common/scoping.ts` — the three frozen memory levels
  (`user | project | workspace`), the `MemoryRecordScope` every persisted
  record carries, `MemoryScopeAddress`, the pure `resolveScope` resolution
  law (a query resolves to exactly one address; workspace-level wins for
  workspace-context queries; resolution is total over the three levels),
  and the `SCOPE_VISIBILITY_LATTICE` read table with the `mayRead` guard.
- `common/enablement.ts` — the DEFAULT-OFF law: `MemoryEnablement`
  per-level opt-in records, pure `enableLevel`/`disableLevel` transitions
  with the `EnablementChange` audit trail, the `canUseMemory` guard, and
  `requestMemoryUse` typed authorization (a disabled level is a typed
  refusal carrying the level and the enablement state — never a silent
  empty result, never an exception).
- `common/entry.ts` — `MemoryEntry` records with provenance disclosure
  (task-evidence / operator-entry / derived), the SECRET-EXCLUSION law
  (`SECRET_PATTERNS`, `isSecretShaped`, fail-closed
  `canAdmitEntry`/`admitEntry`), and the revision-append law (`reviseEntry`
  chains `revisionDigest` and never mutates history).
- `common/lifecycle.ts` — retention (per-level TTL constants,
  `retentionVerdict`, `applyRetention` with expire-receipts, all against an
  injected clock delta), typed `DeleteReceipt` deletion evidence
  (`deleteEntry`), and the `ExportBundle` (level-enabled gated,
  integrity-pinned by a bundle digest).
- `runtime/memoryRuntime.ts` — the live runtime binding the frozen
  contracts onto the REAL tiered store
  (`extensions/flauz-memory/src/memory.ts`, bound through
  `MemoryStoreOptions` with an injected clock + fs port): the DEFAULT-OFF
  enablement gate with the durable audit-trail journal + fold re-derivation
  at `<root>/.flauz/memory-runtime/enablement/changes.jsonl`, the disclosed
  scope-tier bridge (user→session / project→task / workspace→project, every
  bridged write/read naming its `MemoryScopeAddress` + tier + table row),
  fail-closed secret-exclusion admission onto the store's no-fabrication
  `record()`, lattice-gated reads (`resolveScope` + `mayRead`), the
  revision-append chain landing as the store's own journal appends, TTL
  retention verdicts + expire-receipts over real records executed through
  the store's sanctioned lanes (pin/compact) with the honest-gap disclosure,
  level-enabled export bundles with the digest round-trip, the typed
  HONEST-GAP refusal for the contract's delete surface, and the dispose law
  (its mocha tdd suite lives beside it at
  `runtime/memoryRuntime.test.ts`).

Tests live in `test/common/*.test.ts` (mocha tdd, mirroring the
labContracts test style).

## The laws

- **Subordination**: memory is subordinate to Workspace OS and tenant
  policy. Every type here is a REQUEST/READ-MODEL shape or a pure law over
  the existing authorities; nothing here is a new authority.
- **Default-off**: memory use requires explicit per-level enablement;
  disabled-level requests and exports are typed refusals, never silent.
- **Secret exclusion (fail-closed)**: secret-shaped content is
  unrepresentable through the admission guard; the pattern family list is
  exported constants and pinned by a canary test; refusals never echo the
  matched content back.
- **Provenance disclosure**: derived entries are disclosed as derived and
  operator entries as manual; nothing presents as original evidence that
  is not.
- **Determinism**: no `Math.random`, no `Date.now`, no `new Date(...)` in
  `common/**`; timestamps are plain ISO-8601 UTC strings; retention takes
  injected clock deltas (days since the ISO epoch at the evaluation
  instant; `isoToEpochDays` is the pure converter).
- **Every persisted record**: `scope: MemoryRecordScope` +
  `contractVersion: string` + plain-string ISO timestamps. (The work
  order's `recordScope` slot on `MemoryEntry` is the
  `scope: MemoryRecordScope` field, per the every-record law; project-level
  records additionally carry the `projectRef` anchor of their level.)

## Projected authorities (read-only)

- `extensions/flauz-isolation/` — the workspace isolation surface.
  "Workspace-local" means what flauz-isolation means;
  `MemoryRecordScope` projects its tenant/workspace boundaries.
- `extensions/flauz-agent/src/types.ts` — the Task/TaskEvent/EvidenceKind
  vocabulary. The task-evidence provenance origin projects its evidence
  kinds (changeset, screenshot, command-output, note).
- `extensions/flauz-telemetry/src/` — the privacy/census secret-shaped
  value sweep; the secret-exclusion law mirrors that discipline at the
  memory admission boundary.

Workspace OS and tenant policy remain the superior authorities:
enablement records are requests/read-models that a tenant may always
tighten from above, never loosen.

## Self-containment (the zero-import law)

Contract modules in `common/` import nothing (exactly like
`build/flauz/lab/common/labContracts.ts`). The shared foundations — the
version constant, `MEMORY_LEVELS`, `MemoryRecordScope`, the ISO timestamp
law, the digest construction — are restated locally in each module that
needs them, and `lifecycle.ts` restates the entry and enablement record
shapes as structural mirrors. Structural typing keeps every restatement
interchangeable; the cross-contract tests in
`test/common/lifecycle.test.ts` pin that real records from `entry.ts` and
`enablement.ts` flow through the lifecycle surface unchanged.

The digest (`digestOf`) is deterministic FNV-1a (two seeded 32-bit lanes,
`fnv1a64`: 16 hex characters). It is NOT cryptographic: it pins integrity
within this contract set (tamper-evidence for revisions, bundles, and
receipts), not adversarial security.

## Sibling-wave overlap disclosures

- **ZC-001** (merged; the `build/flauz/zcode-patterns/` common/test trees
  are its authority): the THIN memoryProjection pattern family and this
  DEEP scoped-memory set overlap conceptually. This set is standalone by
  the zero-import law: it does not edit, import, or duplicate the THIN
  projection records; it governs the DEEP persisted records (enablement,
  entries, bundles, receipts) that a runtime store would keep.
- **ZC-003 hook-bus** (merged via PR #146; read-only authority): the
  `EnablementChange` audit trail and the expire/delete receipts are plain
  records here. Any event publication over the hook-bus is that wave's
  surface; nothing here wires or duplicates it.
- **ZC-004 observatory** (merged via PR #147; read-only authority): not
  created and not edited here; any census or observability projection over
  memory records belongs to that wave.

## Composition note

The contracts compose at the caller: authorize a level with
`requestMemoryUse` (enablement contract), then admit or revise entries
(entry contract), then retain, export, or delete (lifecycle contract). The
entry contract does not re-derive enablement — it cannot import it under
the zero-import law — and the composed flow is pinned by the
cross-contract tests.

## Gates

1. Scoped strict tsc over `build/flauz/zcode-patterns/memory/**/*.ts`
   (strict, noEmit, target ES2022, module NodeNext, moduleResolution
   NodeNext, verbatimModuleSyntax, types ["node","mocha"]).
2. `npx mocha --ui tdd build/flauz/zcode-patterns/memory/test/common/*.test.ts`.
3. Determinism grep over `common/`: only the per-file determinism
   law-comment line matches.
4. Import-law: zero import statements in `common/`.
5. Placement: only `build/flauz/zcode-patterns/memory/**`.

Honest TL-application record (2026-10-05): the delivery lane is the
kick-spawned text-only worker (chat `d3d18264`). The transport truncated
`common/entry.ts` at 13377 chars; the complete file (22094 chars) was
re-emitted by the worker on request and harvested from the second
occurrence. TL review fixes: two test import drifts (`type MemoryLevel` in
entry.test; `isDigest` in lifecycle.test) and the epoch-day round-trip
floating-point fix (`Math.round` + the 86400 second-carry) — mocha then
landed at the worker's exact designed count, 90/90.
