ZC-007 - External Capability-Source Adapter Contracts (Phase C)

Versioned, zero-dependency contract set for external capability-source adapters: SOURCE_ADAPTERS_CONTRACTS_VERSION = '1.0.0' (duplicated verbatim in each common/ module; cross-pinned by the test suites).

External sources (Printing Press / Printing Press Library, Composio, MCP/skill catalogues, user-supplied API/site/community-project specifications) are REPLACEABLE IMPORT SOURCES ONLY. They provide discoverable artifacts. Flauz remains the verification and execution authority.

Module index
common/source.ts - the frozen SourceKind vocabulary (nine kinds), SourceDescriptor (with the projected healthState), the SourceRegistry and its pure transitions registerSource / retireSource (idempotent-guarded, revision-append law, typed retire reasons) and the pure query sourcesForKind.
common/adapter.ts - the typed adapter interface shape (CapabilitySourceAdapter, a type and never a runtime here), AdapterDescriptor, the AdapterRegistry with the replacement law (registerAdapter, supersedeAdapter, adapterFor: exactly one activeadapter per kind; a kind without an adapter is the typed no-adapterdisclosure, never a silent skip), and the Discovery / Fetch / Normalize request and result shapes (DiscoveredArtifact; FetchResult is the contract about bytes - digest and byte size, never the bytes). Holds twin copy A of the zc006-permission-table seam.
common/import.ts - ImportRecord, the forward-only evidence-bearing import state machine discovered -> fetched -> normalized -> registered, the fail-closed admission guard canImport, ImportedEntry (the Flauz-owned record the import produces), makeImportedEntry and importTransitionsEqual. Holds twin copy B of the zc006-permission-table seam and the zc006-verification-statuses seam.
test/common/source.test.ts - mocha tdd suite for common/source.ts (includes the cross-module version parity pin).
test/common/adapter.test.ts - mocha tdd suite for common/adapter.ts (includes the cross-module parity pins).
test/common/import.test.ts - mocha tdd suite for common/import.ts (includes the admission, authority-law and projection pins).
Laws
Import sources only. External sources provide discoverable artifacts; they never verify, execute or rank. No network calls, no runtime discovery, no fetch execution, no caching engine: types, constants, pure guards and transition maps only.
Flauz remains the verification and execution authority. Imported entries become Flauz-owned records with hashes, licenses, declared permissions/endpoints and verification status. Verification is Flauz's own gate (the ZC-006 receipt path), never the source's claim: imported entries ALWAYS enter as unverified.
Fail-closed admission. Missing license or artifact digest, or out-of-table permissions, reject the import with the violation named. Akind without an active adapter is the typed no-adapter disclosure, never a silent skip.
Determinism. No Math.random, no Date.now, no new Date(...) in common/**; all timestamps are plain ISO-8601 strings supplied by callers.
Every persisted record carries scope: SourceScope (workspaceId, tenantId) and contractVersion: string. Records that appear as entriesof a persisted list (registry revisions, adapter registrations, import transition evidence) are individually stamped; singular embedded values(query filters, provenance) ride inside their stamped parent record.
Zero-dependency. No import statements in common/** contract modules. Shapes shared across the sibling modules are duplicated verbatim andcross-pinned by the test suites, so drift fails the gates.
Runtime adapter execution (network fetch, discovery probing, health probing) is out of scope by law: this wave is the typed contract set only.
Seams (fill at harvest time - inline instructions at each site)
SEAM(zc006-permission-table) - twin copies in common/adapter.ts and common/import.ts; transcribe the frozen ZC-006 permission-table vocabulary verbatim into BOTH copies, identically.
SEAM(zc006-verification-statuses) - common/import.ts; this wave pinsonly unverified; transcribe the ZC-006 receipt-path status vocabulary when that authority lands.
SEAM(mit-copyright-line) - align the copyright line in every file header with the repo-canonical MIT header.
Gates
Scoped strict tsc (strict, noEmit, target ES2022, module NodeNext, moduleResolution NodeNext, verbatimModuleSyntax, types ["node","mocha"]) over build/flauz/capabilities/sources/**/*.ts.
npx mocha --ui tdd build/flauz/capabilities/sources/test/common/*.test.ts.
Determinism grep over common/ - only law-comment lines may match.
No import statements in common/ contract modules.
Placement: only build/flauz/capabilities/sources/**.

License: MIT.
