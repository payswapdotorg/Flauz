# Flauz command facade contracts (ZC-008, Phase C)

Typed contract set for the agent-native command facade: bounded typed
compound commands, safe local mirrors/caches, and the facade routing
surface over the existing Tool/Resource/Approval authorities.

Contract set version: `COMMAND_FACADE_CONTRACTS_VERSION = '1.0.0'`,
carried by every module and stamped on every persisted record.

## Module index

- `common/compound.ts` - bounded typed compound commands:
  `CompoundCommand`, `CompoundStep`, the `MAX_COMPOUND_STEPS` bound,
  `canAdmitCompound` (pure admission guard, fail closed),
  `CompoundExecutionRecord` (the provenance-bearing step receipt trail).
- `common/mirror.ts` - safe local mirrors/caches: `LocalMirror`,
  `FreshnessPolicy` (exported plain-number window constants),
  `mirrorVerdict` (pure fresh/stale/expired, inclusive boundaries),
  `canMirror` (the safe-mirror admission guard), `MirrorInvalidation`
  and `invalidateMirror` (typed invalidation transitions).
- `common/facade.ts` - the facade surface: `CommandFacadeRequest`
  (compound | mirrored-read | direct-tool), `routeFor` (the pure
  routing verdict through the existing authorities),
  `SideEffectDisclosure` (side effects are always visible),
  `FacadeReceipt` and `deriveFacadeReceiptsDigest` (deterministic).
- `test/common/*.test.ts` - mocha tdd suites: behavioral tests on
  synthetic `fixture.`-prefixed values (never authority values),
  cross-module agreement pins, and SEAM-PIN suites that activate when
  the named seams are transcribed repo-side.

## Laws

- Bounded optimizations only: compound commands and local mirrors are
  optimizations that preserve provenance and side-effect visibility.
  No facade runtime, no command executor, no cache engine, no storage.
  This wave is the typed contract set only: any runtime facade EXECUTOR
  or mirror STORE is out of scope by law.
- Side effects remain visible, provenance-bearing, and routed through
  the existing Tool/Resource/Approval authorities. The facade never
  bypasses an authority: confirmation-gated tools always route through
  the Approval authority (fail closed), direct tools route exactly as
  the Tool authority would route them, and a stale or expired mirror is
  never served silently (typed bypass disclosure on every redirect).
- Mirrors are read-only: the mirrorable-surface table is frozen and
  closed; write-shaped or approval-shaped surfaces never mirror.
- Determinism: no clock reads and no randomness inside `common/**`;
  timestamps are plain ISO strings and clock deltas are injected.
- Every persisted record carries `scope: FacadeScope` and
  `contractVersion`.

## Repo-side completion (before running the gates)

Two named seams ship empty by design and must be transcribed from the
read-only authorities, into BOTH module copies (the test suites pin the
copies deep-equal):

- `SEAM(TOOL_VOCABULARY)`: `FROZEN_TOOL_VOCABULARY` in
  `common/compound.ts` and `common/facade.ts`, from
  `extensions/flauz-agent/src/types.ts` (tool vocabulary), with
  confirmation gating per `extensions/flauz-agent/src/orchestrator.ts`
  and `extensions/flauz-agent/src/tools/terminalTool.ts`.
- `SEAM(MIRRORABLE_SURFACES)`: `FROZEN_MIRRORABLE_SURFACES` in
  `common/mirror.ts` and `common/facade.ts`, read-only resource surface
  kinds from `extensions/flauz-execution/src/contracts.ts`, cross-
  checked against `extensions/flauz-isolation/` (workspace boundaries).

Until transcription, the guards fail closed and 5 SEAM-PIN tests are
red by design; after correct transcription the full suite is green.
