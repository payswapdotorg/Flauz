# CR-007 — External Source Adapters · Phase C-R, B2, wave 2

Adapter kit + four deterministic fixture adapters over the CR-006 registry.
Emitted from a text-only session: **no code has been executed** — see `REPORT.md`
for verification steps and open reconciliation items.

## Layout

| Path | Role |
| --- | --- |
| `adapterKit.mjs` | Kit runtime: adapter registry + `discoverFrom` / `importFrom` / `importAll` pipelines (plain ESM JS) |
| `adapterKit.d.mts` | Hand-maintained TypeScript declarations for the kit |
| `sources/printingPress.ts` | Adapter: 7 press-production documents (fixtures) |
| `sources/composio.ts` | Adapter: 6 integration tools (fixtures) |
| `sources/mcpSkills.ts` | Adapter: 6 MCP skills (fixtures) |
| `sources/direct.ts` | Adapter: 3 seed notes + runtime passthrough (`add`/`clear`/`reset`) |
| `sources/adapters.ts` | Barrel + `installBundledAdapters()` (no import side effects) |
| `adapters.test.ts` | Test suite (54 tests, `node:test`) |
| `tsconfig.json` | Typecheck-only config for the mixed `.mjs`/`.ts` tree |
| `REPORT.md` | Work-order report, assumptions, paste requests |

## Requirements

- **Node.js ≥ 22.18.0** (or ≥ 23.6.0): `.ts` files run through built-in type
  stripping with no flags. On Node 22.6–22.17 add `--experimental-strip-types`.
- The ESM `.ts` files rely either on the project root `package.json` having
  `"type": "module"` or on Node's module syntax detection. If you hit CJS/ESM
  errors, add `{"type":"module"}` to the root `package.json`.
- Typechecking only (not needed at runtime): `npm i -D typescript @types/node`.

## Commands

```sh
# Run the CR-007 suite (explicit paths: .ts auto-discovery in `node --test`
# is version-dependent):
node --test adapters.test.ts

# Run both suites:
node --test adapters.test.ts registry.test.ts

# Typecheck (no emit):
npx tsc --noEmit
```

## The adapter contract

An adapter is a plain object satisfying `ExternalAdapter` (see `adapterKit.d.mts`):

```ts
interface ExternalAdapter {
  id: string          // no ':' — reserved as the namespace separator
  displayName: string
  description: string
  discover(): AdapterRecord[] | Promise<AdapterRecord[]>
}
```

`AdapterRecord` fields: `localId` (must match `/^[A-Za-z0-9][A-Za-z0-9._-]*$/`),
`kind` (one of `document | tool | skill | note`), `title` (non-empty), `summary?`,
`tags?`, `payload?` (plain object). Invalid records are never thrown from
`discoverFrom` — they are collected in `DiscoveryResult.rejected` with reasons.

The `direct` adapter extends the contract with `add(...records)` (records are
cloned on insertion), `clear()`, `reset()` and `size()` for runtime passthrough;
it starts from a deterministic three-note seed catalogue.

## Pipelines

- `discoverFrom(sourceId)` — runs the adapter's `discover()`, validates and
  normalizes each record into a `CatalogueEntry` (`id = "<sourceId>:<localId>"`,
  sorted/deduped tags, default `payload: {}`, FNV-1a checksum). Deterministic:
  no timestamps, no network, no registry access.
- `importFrom(sourceId, options?)` — discovery, then optional filters, then
  registration into a registry target. Options:
  - `registry` — override the registry target (default: the CR-006 registry)
  - `dryRun` — read-only: reports `planned` ids, writes nothing
  - `now` — injectable clock used for `importedAt` (default `Date.now`)
  - `kinds`, `tags` (any-match), `ids` — import filters; `unmatched` in the
    result lists requested ids that matched no importable candidate
- `importAll(options?)` — `importFrom` for every registered source.

Duplicate handling: existing ids are skipped with reason `duplicate`, or
`stale-duplicate` when the stored checksum no longer matches the catalogue.

## Registry seam (CR-006)

The kit touches the CR-006 registry through exactly three functions —
`register(entry)`, `has(id)`, `get(id)` — loaded lazily from `./registry.mjs`.
Self-diagnosing failure modes:

- `AdapterError('REGISTRY_UNAVAILABLE', …)` — `./registry.mjs` could not be loaded.
- `AdapterError('REGISTRY_SEAM_MISMATCH', …)` — module loaded but does not
  export `register`/`has`/`get`.

In either case the fix is local to `bindRegistryModule()` in `adapterKit.mjs`
(plus the `RegistryEntry`/`RegistryTarget` types in `adapterKit.d.mts` if the
entry shape differs). Tests inject stub registries; only the two smoke tests in
`adapters.test.ts` exercise the real registry.

## Determinism policy

- All four adapters are offline fixture catalogues: no network, no clocks.
- Discovery results carry no timestamps; `importedAt` comes from the injected
  `now` (or `Date.now` at import time).
- Checksums are FNV-1a-32 over canonical JSON (sorted keys), domain-prefixed
  with `catalogue/v1` — available as `stableChecksum(value)`.
