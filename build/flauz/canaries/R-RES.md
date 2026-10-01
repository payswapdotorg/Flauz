# Canary R-RES — Flauz logical resource graph (ResourceRef + access surfaces + continuity + provenance)

- **Matrix row (TL3-005, Worker C)**: the ARCHITECTURE-LOCK "Workspace OS"
  pillar's logical resource graph (lock section 3) and the `ResourceRef`
  contract family (lock section 5). Files, tasks, sessions, environments,
  artifacts, evidence, models and providers are unified behind URN-shaped
  logical identities WITHOUT flattening their divergent access surfaces,
  with fail-closed provenance on every mutation and continuity
  (restore/reattach) metadata.
- **Lane**: `extensions/flauz-resources` (TL3 lane, branch
  `flauz/tl3-005-resource-graph`; base 4c96dad50d6fe87ded1599ec561c54d37573e7b1).
- **Tree evidence (all paths verified @ 4c96dad5)**:
  - Sibling-envelope discipline (DL-9/DL-32): `extensions/flauz-workspace/src/api.ts`
    (canonical JSON, atomic tmp+rename, FileSystemPort/Clock) and
    `extensions/flauz-environments/src/api.ts` (vault-only secret references,
    `isSecretRef`); the hash-chain discipline in
    `extensions/flauz-workspace/src/ledger.ts`.
  - The evidence-row seam: `extensions/flauz-browser/src/policy.ts`
    (`toEvidenceRow` — kind note + uri + sha256 + note).
  - Activation discipline: `build/flauz/scripts/activation-lint.mjs`
    (R2 whitelist `onCommand:flauz.*`; R3 `onStartupFinished` cap spent by
    flauz-agent + flauz-workspace).
  - Bundle discovery: `build/flauz/scripts/bundle-extensions.mjs` globs
    `extensions/flauz-*/src/extension.ts` (no build-script change needed
    for this lane).
- **Owner CI**: `.github/workflows/flauz-resources.yml` (job
  `rres-resource-graph`) — phase-1 ONLY (zero-dep unit + typecheck +
  activation lint + YAML-embedded fixture canary; zero secrets; path-gated
  on the Flauz path set + `workflow_dispatch`). The boot phase is deferred:
  v0 has no runtime surface yet (no proposals, command-only activation);
  the lane-presence probe pattern is kept for the future boot job.

## Setup

1. Zero-dep phase (always): `node --test extensions/flauz-resources/test/*.test.ts`
   (Node >= 23.6 for type-stripping) + `tsc --noEmit` (isolated global
   typescript install, like flauz-browser's unit job).
2. Fixture canary: YAML-embedded `node --input-type=module` steps (the
   flauz-browser B-POLICY A1 pattern) — no `.mjs` runner, so
   `.eslint-allowed-javascript-files` stays untouched.
3. Activation lint: `node build/flauz/scripts/activation-lint.mjs --root .`
   (this extension must appear and be clean; command-only activation).

## Steps

1. Run the unit suites (api / graph / continuity / provenance / contract /
   extension) — the full schema + integrity + continuity contract.
2. Run the YAML-embedded fixture canary (assertions A1-A7 below).
3. Run the activation lint (B3 below).
4. **[boot-level — DEFERRED]** No runtime surface exists in v0 (no live
   browser/environment drivers, no proposals, no UI contribution beyond
   the four palette commands). A boot job (bundled-extension surface grep
   of the 4 `flauz.res.*` commands) follows the C-ENV phase-2 recipe when
   the first runtime-dependent lane lands.

## Expected (assertions)

| # | Assertion | Mechanism | Status |
|---|---|---|---|
| A1 | good fixture loads: 10 nodes / 10 edges / 8 surface records, `$schema` pinned, `verifyEnvelope` clean | embedded canary step | automated (fixture) |
| A2 | every bad fixture (69-file matrix) rejected with `flauz.resources/v0:`-prefixed errors (every validation rule violated at least once; fixture 69 = the DL-82 restored-from plan-kind legality — `restored-from`/`snapshot-of` from `task`/`agent-session`/`workflow` kinds rejected at load, append and verify) | embedded canary step | automated (fixture) |
| A3 | the identity law: paths/URLs are rejected as ref ids; URN namespaces match kinds; Worker A's `flauz:browser:<16-hex>` + the registry's `env-*` ids validate | embedded canary step | automated (fixture) |
| A4 | surface versioning: a path move / endpoint swap retains the prior version — identity survives access-surface change (the unification-without-flattening acceptance) | embedded canary step (live temp workspace) | automated (fixture) |
| A5 | provenance: every mutation appends an ops record with a mandatory actor; before/after digests chain to the persisted state; a truncated/tampered tail fails the chain | embedded canary step (live temp workspace) | automated (fixture) |
| A6 | contract fixtures pinned: the restoration planner's browser-session + environment summaries match the literal `contracts/` fixtures byte-for-byte (canonical JSON) — integration drift between the parallel TL3 branches fails here first | embedded canary step | automated (fixture) |
| A7 | vault-only policy: a runtime-assembled secret-shaped literal (fragments joined at runtime — never a complete secret in source) is rejected at the schema level | embedded canary step | automated (fixture) |
| B1 | typecheck green (`tsc --noEmit`, isolated global typescript — never a repo install) | unit job step | automated |
| B2 | unit suites green (83 cases across the 6 suites) | unit job step | automated |
| B3 | activation stays command-driven (only `onCommand:flauz.res.*`; activation-lint R1/R2/R3 green; this extension stays off `onStartupFinished`) | `activation-lint.mjs` in the zero-dep phase | automated |
| P1 | bundled extension carries the 4 `flauz.res.*` command contributions (boot-level grep) | boot job (deferred) | **DEFERRED** (no runtime surface in v0) |
| P2 | live restoration: plan execution through the browser/environment runtimes (Workers A/B seams) | runtime drivers | **WAITING-ON-RUNTIME** (Wave-next; INTEGRATION-GAP §3) |

## Drift trip-wires

- A6 firing means a cross-worker contract drifted (BrowserSessionDescriptor
  summary shape, environment descriptor id/summary, or the evidence-row
  seam) — the literal fixtures exist to force a DELIBERATE contract update
  (both sides), not silent drift.
- A2 count dropping below 60 means the bad-fixture matrix lost coverage
  (rule regression or fixture loss) — the matrix is the validation contract.
- B3 firing means an activation event left the whitelist (or someone added
  `onStartupFinished` — the cap belongs to flauz-agent + flauz-workspace).
- The edge legality matrix (v0 closed set) is pinned by unit tests; widening
  it for integration needs must update EDGE_LEGALITY + the tests + this
  spec's contract notes together.

## Cross-refs

- `extensions/flauz-resources/INTEGRATION-GAP.md` — the extension-land vs
  product-side boundary + the cross-worker contract table.
- `docs/FLAUZ-PROGRAM/ARCHITECTURE-LOCK.md` section 3 (Pillar 3 Workspace
  OS) + section 5 (contract families incl. ResourceRef).
- `test/fixtures/resources/README.md` — the fixture matrix conventions
  (incl. the runtime-assembly rule for secret-shaped bad cases).
