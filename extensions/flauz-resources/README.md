# Flauz Resources (TL3-005, Worker C)

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
  stable-sorted output); `addRef`/`updateRef`/`removeRef` (refuses while
  edges/surfaces reference the node — typed error listing them),
  `addSurface` (versioned), `addEdge`/`removeEdge` (typed endpoint +
  legality validation), queries (`byKind`, `neighbors`, `lineage` over the
  produced/restored-from/snapshot-of chain, `surfacesFor`), integrity
  verification (`verifyEnvelope`/`verifyWorkspace`) and the DOT export.
- `src/provenance.ts` — the append-only mutation log
  `.flauz/resources-ops.jsonl` (`flauz.resources-ops/v0`): op, ref id,
  actor (MANDATORY), timestamp, before/after digests (sha256 of the
  canonical envelope). The records chain via the state digests;
  `verifyChain` detects truncation and tampering.
- `src/continuity.ts` — `RestorationPlan` per family: browser-session
  (sessionId/initiator/partition/state summary, contract-aligned with
  Worker A's BrowserSessionDescriptor), environment (registry descriptor
  id + lifecycle summary + plan re-execution hint; the sibling
  `.flauz/environments.json` is probed read-only when present), and
  file/artifact (path + content hash). `restore(refId)` returns the plan
  and records the `restored-from` edge (origin = explicit `fromRefId` or
  the newest `snapshot-of` ancestor; no free-floating restorations).
  Continuity metadata NEVER carries credentials.
- `src/extension.ts` — the thin vscode wiring: command-driven activation
  only (`onCommand:flauz.res.*`; activation-lint R3 keeps this extension
  off `onStartupFinished`). The `FileSystemPort` binds `vscode.workspace.fs`
  (readFile/writeFile/createDirectory/rename; appendFile as
  read-concat-write) — fully mock-testable.
- `test/` — `node --test` suites (api / graph / continuity / provenance /
  contract / extension). Zero dependencies; Node >= 23.6 (type stripping).
  The repo fixture matrix lives at `test/fixtures/resources/` (repo root);
  secret-shaped bad cases are assembled from fragments at RUNTIME (never a
  complete secret shape in source).

## Persistence

- `.flauz/resources.json` — the graph envelope (`flauz.resources/v0`):
  `{ $schema, nodes, edges, surfaces }`, canonical + stable-sorted,
  git-diffable, written atomically (tmp + rename).
- `.flauz/resources-ops.jsonl` — the append-only provenance log, one
  canonical-JSON line per mutation.
- `.flauz/environments.json` — READ ONLY (the flauz-environments registry
  contract file; probed by the continuity service, never written here).

## Commands

- `flauz.res.list` — list refs, optionally filtered by kind.
- `flauz.res.show` — ref + surfaces + edges + lineage.
- `flauz.res.graph` — JSON dump of the envelope, or a `dot`/`--dot`/
  `{ dot: true }` Graphviz rendering.
- `flauz.res.verify` — schema + integrity verification (edge targets
  exist, no orphan surfaces, no secret-shaped values, provenance complete,
  ops digest chain intact).

v0 exposes no mutation commands on the palette: every mutation requires
fail-closed provenance and the Agent OS integration is the intended writer
(see INTEGRATION-GAP.md).

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
