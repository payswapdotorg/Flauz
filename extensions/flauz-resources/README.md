# Flauz Resources (TL3-005, Worker C + TL3-006)

The Flauz **logical resource graph**: files, tasks, agent sessions, browser
sessions, environments, artifacts, evidence, models, providers and workflows
unified behind a `ResourceRef` identity model — WITHOUT flattening their
divergent access surfaces — with fail-closed provenance on every mutation
and continuity (restore/reattach) metadata.

**The law this extension encodes (ARCHITECTURE-LOCK section 3, Pillar 3
"Workspace OS"; section 5 `ResourceRef` contract family): IDENTITY IS NOT
ACCESS.**

- A `ResourceRef` carries logical identity only: a URN-shaped id
  `flauz:<kind>:<16-hex-or-slug>` (e.g. `flauz:browser:3f9a2b1c8d7e4f60` —
  exactly Worker A's pinned BrowserSessionDescriptor session ids;
  `flauz:environment:env-staging` — the local part IS the
  flauz-environments registry descriptor id). A ref NEVER carries a
  filesystem path, URL, endpoint or credential; paths/URLs as ids are
  rejected at the schema level.
- Access data lives in SEPARATE, per-family, VERSIONED `Surface` records
  bound by ref id: `file-system`, `browser`, `environment`, `model`, `task`,
  `artifact`, `workspace`. A surface change (path move, endpoint swap)
  appends a version and RETAINS the prior surface — the ref identity
  survives. That is "unification without flattening".
- Every mutation (add/update/remove ref, surface version, edge, restore)
  carries provenance with a MANDATORY actor (`agent` | `human` | `tool`);
  a missing actor is a schema rejection (fail-closed provenance).

## Layout

- `src/api.ts` — the contract types + validation predicates + canonical
  serialization (DL-9/DL-32 sibling-envelope discipline: canonical JSON,
  sorted keys, 2-space pretty form, one trailing newline, atomic
  tmp+rename), the vault-only secret policy (secret-shaped literals
  REJECTED; `vault:`/`env:` references are the only legal secret carrier),
  the edge-legality matrix, `FileSystemPort`/`Clock` ports, pure-TS sha256.
- `src/graph.ts` — `ResourceGraph`: `.flauz/resources.json`
  (`flauz.resources/v0`) persistence (nodes + edges + surfaces,
  stable-sorted output) with STRICTLY SERIAL mutations (the DL-77
  transition lock — concurrent callers queue, none interleave);
  `addRef`/`updateRef`/`removeRef` (refuses while
  edges/surfaces reference the node — typed error listing them),
  `addSurface` (versioned), `addEdge`/`removeEdge` (typed endpoint +
  legality + ANCESTRY-CYCLE validation: the `produced` / `restored-from` /
  `snapshot-of` / `derived-from` relations must stay acyclic per kind —
  mutual ancestry is temporally impossible and rejected at append, at
  load and by verify), queries (`byKind`, `neighbors`, `lineage` over the
  produced/restored-from/snapshot-of chain, `surfacesFor`), integrity
  verification (`verifyEnvelope`/`verifyWorkspace`) and the DOT export.
- `src/provenance.ts` — the append-only mutation log
  `.flauz/resources-ops.jsonl` (`flauz.resources-ops/v0`): op, ref id,
  actor (MANDATORY), timestamp, before/after digests (sha256 of the
  canonical envelope) and `prev` — the sha256 of the PREVIOUS record's
  canonical line (null on the genesis record). The records chain twice:
  through the state digests (record N's `beforeDigest` equals record N-1's
  `afterDigest`) AND through the per-row `prev` hash chain — so reorder,
  delete, truncate, digest edit, seq edit and in-place CONTENT edit of any
  non-final record are all detected; an empty ledger over a non-empty
  graph is erased history. Appends are STRICTLY SERIAL (the DL-77
  transition lock) and the file is only ever extended (a torn tail —
  missing trailing newline — refuses to parse or extend). `verifyChain`
  detects truncation and tampering.
- `src/continuity.ts` — `RestorationPlan` per family: browser-session
  (sessionId/initiator/partition/state summary, contract-aligned with
  Worker A's BrowserSessionDescriptor), environment (registry descriptor
  id + lifecycle summary + plan re-execution hint; the sibling
  `.flauz/environments.json` is probed read-only when present), and
  file/artifact (path + content hash). `restore(refId)` returns the plan
  and records the `restored-from` edge (origin = explicit `fromRefId` or
  the newest `snapshot-of` ancestor; no free-floating restorations).
  Continuity metadata NEVER carries credentials.
- `src/journalBridge.ts` — TL3-006, the browser-session journal bridge:
  the STRICT PIN-1 reader (own zero-dep parser over
  `.flauz/browser-sessions.jsonl` — shape + enums + descriptor +
  CANONICALITY; invalid lines become TYPED SKIPS with the bad line number
  recorded, never a crash) and `BrowserSessionBridge.sync` — the
  reconciliation that makes journaled browser sessions first-class
  continuable resources (see the journal-bridge section below).
- `src/extension.ts` — the thin vscode wiring: command-driven activation
  only (`onCommand:flauz.res.*`; activation-lint R3 keeps this extension
  off `onStartupFinished`). The `FileSystemPort` binds `vscode.workspace.fs`
  (readFile/writeFile/createDirectory/rename; appendFile as
  read + tmp + atomic rename — an append never mutates the journal in
  place, DL-77) — fully mock-testable.
- `test/` — `node --test` suites (api / graph / continuity / provenance /
  contract / extension / **browserSessions**). Zero dependencies; Node >=
  23.6 (type stripping). The repo fixture matrix lives at
  `test/fixtures/resources/` (repo root); the journal bridge is pinned by
  the EXISTING repo-root fixtures at `test/fixtures/browser-session-journal/`
  (consumed READ-ONLY); secret-shaped bad cases are assembled from
  fragments at RUNTIME (never a complete secret shape in source).

## Persistence

- `.flauz/resources.json` — the graph envelope (`flauz.resources/v0`):
  `{ $schema, nodes, edges, surfaces }`, canonical + stable-sorted,
  git-diffable, written atomically (tmp + rename).
- `.flauz/resources-ops.jsonl` — the append-only provenance log, one
  canonical-JSON line per mutation.
- `.flauz/environments.json` — READ ONLY (the flauz-environments registry
  contract file; probed by the continuity service, never written here).
- `.flauz/browser-sessions.jsonl` — READ ONLY (the flauz-browser PIN-1
  session journal; consumed by the journal bridge, never written here).

## The browser-session journal bridge (TL3-006)

`src/journalBridge.ts` is the READ-ONLY consumer the PIN-1 contract was
built for: it turns journaled browser sessions into first-class continuable
resources of the graph.

- **Strict reader, own parser, zero-dep** — every journal line is validated
  against the pinned PIN-1 contract (shape + actor/event enums + descriptor
  snapshot + CANONICALITY: the bytes must equal the canonical JSON of the
  record). An invalid line becomes a TYPED SKIP `{line, reason}` (the bad
  line number recorded); valid records keep flowing — never a crash. Pinned
  by the EXISTING repo-root fixtures at `test/fixtures/browser-session-journal/`
  (valid + the three invalid samples — consumed READ-ONLY, never modified,
  never imported flauz-browser code; the contract is duplicated as types per
  the DL-32 sibling convention).
- **ResourceRef minting** — kind reuse, no parallel vocabulary: refs are
  kind `browser-session` with the id EXACTLY the journal's logical
  `sessionId` (`flauz:browser:<16-hex>` — already the pinned
  browser-session URN grammar). Identity NEVER derives from tab ids,
  target ids or paths — the latest descriptor per session drives a
  VERSIONED browser surface `{kind:'browser', partition, tabIds}` (prior
  versions retained; identity survives surface change; an unchanged
  surface is a no-op — syncs are idempotent).
- **Graph edges ONLY from EXPLICIT attribution** — the v0 journal carries
  NO environment or task attribution fields, so an unattributed sync mints
  NO edges (never fabricated from an active-environment guess). A
  provenance-carrying caller may assert attribution explicitly
  (`bindEnvironmentRefId` -> `bound-to` session -> environment;
  `bindTaskRefId` -> `depends-on` session -> task); the targets must exist
  as graph refs (typed rejection otherwise — no dangling endpoints).
- **Provenance records** — every mutation flows through `ResourceGraph`
  (fail-closed provenance; each add-ref/add-surface/add-edge is recorded in
  the existing `.flauz/resources-ops.jsonl` with the sync caller's actor).

## Commands

- `flauz.res.list` — list refs, optionally filtered by kind.
- `flauz.res.show` — ref + surfaces + edges + lineage.
- `flauz.res.graph` — JSON dump of the envelope, or a `dot`/`--dot`/
  `{ dot: true }` Graphviz rendering.
- `flauz.res.verify` — schema + integrity verification (edge targets
  exist, no orphan surfaces, no secret-shaped values, provenance complete,
  ops digest chain intact).
- `flauz.res.syncBrowserSessions` — reconcile browser-session refs from
  the PIN-1 journal (READ-ONLY consumption; typed result; args
  `{ actor?, bindEnvironmentRefId?, bindTaskRefId? }`).

v0 exposes no UNATTRIBUTED mutation commands on the palette: every mutation
requires fail-closed provenance and the Agent OS integration is the intended
writer (see INTEGRATION-GAP.md). The TL3-006 journal-sync command is the
documented exception — a bounded, provenance-recorded reconciliation whose
actor defaults to `human` at the palette boundary exactly like the
flauz-environments lifecycle commands (programmatic callers pass `actor`
explicitly).

## Security posture

- **Identity vs access**: refs never carry paths/URLs/endpoints/credentials;
  surfaces are separate, versioned, kind-specific records.
- **Vault-only secrets**: any secret-shaped literal in a ref, surface or
  edge is REJECTED at the schema level; `vault:`/`env:` references are the
  only legal secret carrier (SECURITY-MODEL 3.5 discipline, mirrored from
  flauz-environments).
- **Fail-closed provenance**: a missing actor never reaches the disk; the
  ops ledger refuses to append malformed records; a corrupt graph file
  fails bootstrap loudly (no silent resets — the broken file is never
  overwritten by activation).
- **Fail-closed load**: `parseEnvelope` rejects dangling edges, self-edges,
  illegal endpoint kinds, orphan surfaces and duplicate records at LOAD
  time — the same typed rules mutations enforce.

## Development

```
npm run typecheck   # tsc --noEmit (uses the vendored vscode.d.ts)
npm run test        # node --test "test/*.test.ts"
node build/flauz/scripts/activation-lint.mjs --root .   # from the repo root
```

CI: `.github/workflows/flauz-resources.yml` (phase 1 only; the R-RES
canary spec is `build/flauz/canaries/R-RES.md`).
