# Flauz Capability Packs -- ZC-006 contract and catalog (Phase C, TL-B partition B2)

This subtree is the ZC-006 contract set: versioned DESCRIPTIONS of
agent-facing artifacts (CLI, skill/instructions, MCP server, commands) in the
sense of docs/FLAUZ-PROGRAM/ARCHITECTURE-LOCK.md section 11. Imported entries
become Flauz-owned records with hashes, licenses, declared permissions and
verification status. It is a typed contract surface only.

## Modules

- `common/pack.ts` -- the pack record (`CapabilityPack`), the frozen artifact
  kind table (`cli | skill-instructions | mcp-server | commands`), required
  capability references, the CLOSED permission table with risk tiers, the
  typed configuration schema, provenance, the frozen platform list, pack
  integrity (the pure digest-order function) and `validateCapabilityPack`.
- `common/verification.ts` -- the frozen verification vocabulary
  (`unverified | verified | verified-partial | verification-failed`), the
  verification receipt, the derived-status law (`verificationStatusFor`) and
  the fail-closed admission guard (`canAdmitToCatalog`).
- `common/catalog.ts` -- the catalog record and its append-only pure
  transitions: `registerPack`, `deprecatePack`, `verifyPack`, `queryCatalog`,
  plus the pure predicate builders (artifact kind, platform, permission tier,
  verification status).
- `test/common/pack.test.ts`, `test/common/verification.test.ts`,
  `test/common/catalog.test.ts` -- the mocha tdd suites, in the style of
  `build/flauz/lab/test/common/labContracts.test.ts`.

## Contract version

`CAPABILITY_PACKS_CONTRACTS_VERSION = '1.0.0'`. Every module under `common/`
declares it locally (the zero-import law forbids sharing it through an import)
and every persisted record carries it in its `contractVersion` field. The
cross-module tests pin all three declarations equal.

## Laws

1. Descriptions, not executors. No loader, no installer, no executor, no
   downloader, no hash-verifier runtime. Types, constants, pure guards,
   transition maps and pure digest-order functions only.
2. Zero imports inside `common/`. Each contract module is self-contained,
   exactly like `build/flauz/lab/common/labContracts.ts`.
3. Permissions are a closed table (`read-files`, `execute-command`,
   `network-access`, `write-workspace`, each with a risk tier). A pack cannot
   invent permissions; out-of-table declarations are typed rejections, and no
   configuration default may grant an undeclared permission.
4. Verification is the authority gate. A catalog entry never changes its
   verification status without a receipt matching its identity exactly;
   mismatches are named failures, never silent.
5. Determinism. No Math.random, no Date.now, no new Date() inside `common/`;
   every timestamp is a caller-supplied plain ISO-8601 string.
6. Every persisted record carries `scope: PackScope` and
   `contractVersion: string`.
7. Style: tabs, ASCII only, MIT headers, `.js` import suffixes in tests,
   `as const` lists with derived unions.

## Pinned mirrors

The zero-import law forces each `common/` module to restate the vocabularies it
consumes from its siblings (PackScope, the version constant, the digest/semver/
ISO shapes, the artifact kinds, the platforms, the permission table, the
verification vocabulary, the receipt shape, the derived-status law). Each
restatement is a PINNED MIRROR of its authority, never a second authority:

- `pack.ts` is the authority for the pack record, artifact kinds, platforms,
  the permission table and the configuration law.
- `verification.ts` is the authority for the verification vocabulary, the
  receipt and the derived-status law.
- `catalog.ts` mirrors the subsets it consumes; `deriveCatalogEntryStatus` is
  the behavioral mirror of `verificationStatusFor` (plus the catalog-only
  null-receipt `unverified` path).

The cross-module suites pin every mirror set-equal and behaviorally equal to
its authority.

## Pinned semantics (decisions traceable to the work order)

- `registerPack` takes `registeredAtIso` and `deprecatePack` takes the whole
  deprecation record as explicit caller-supplied arguments: the determinism
  law forbids a clock inside `common/`.
- Entries carry `deprecationReason` and `deprecationNote` alongside
  `deprecatedAtIso` because the "typed reason required, never silent" law
  forces the reason onto the record; the three fields are all-or-nothing.
- Entries carry `packFacts` (name digest, artifact kinds, platforms, declared
  permissions, highest permission tier) because `queryCatalog` filters by
  artifact kind, platform, permission tier and verification status.
- A duplicate ACTIVE `packId+version` registration is the typed rejection
  `catalog-rejected-duplicate-pack`; re-registering a DEPRECATED
  `packId+version` appends a NEW revision entry and never mutates history.
- A pack may register carrying a receipt that does not match it: the entry
  then carries the derived `verification-failed` status (the mismatch is named
  by the exported derivation). The catalog never upgrades a status without a
  matching receipt: `verifyPack` rejects any mismatched receipt.

## Seams

- SEAM: REQUIRED_CAPABILITY_REF_KINDS (`common/pack.ts`). The dispatch order
  projects the ExecutionResourceRef vocabulary of
  `extensions/flauz-execution/src/contracts.ts` (read-only). The current list
  `['resource', 'capability']` is a PLACEHOLDER. Transcribe the exact
  discriminant literals verbatim into the constant, then complete the verbatim
  pin marked SEAM in `test/common/pack.test.ts`. The existing seam tests
  iterate the exported constant, so they stay green before and after the
  transcription.
- SEAM: TEST-IMPORTS. The suites import `assert` via
  `import * as assert from 'assert'` and use strict assertions. If
  `build/flauz/lab/test/common/labContracts.test.ts` uses a different import
  line or a file-level pragma, transcribe it verbatim into the three suites.
- SEAM: HEADER. If the repository's MIT header (the copyright holder line in
  `build/flauz/lab/common/labContracts.ts`) differs from the one used in these
  files, transcribe it verbatim.
- SEAM: MOCHA-RUNNER. The gate
  `npx mocha --ui tdd build/flauz/capabilities/packs/test/common/*.test.ts`
  assumes the repository's existing mocha + TypeScript pipeline (the one that
  runs the lab suites) resolves `../../common/*.js` imports under NodeNext. If
  the lab suites rely on a scoped `.mocharc` entry, mirror it for this tree.

## Out of scope (by law)

Any runtime pack LOADER, INSTALLER, EXECUTOR, DOWNLOADER or hash-verifier:
this wave is the typed contract set only. Packaging parity, SBOM,
productionization and the extension surfaces live in other waves.

## Sibling waves

`build/flauz/capabilities/README.md`, `background-agent/**`, `sources/**` and
`commands/**` are owned by sibling waves and are intentionally absent here.
This tree stands alone in `build/flauz/capabilities/packs/`.
