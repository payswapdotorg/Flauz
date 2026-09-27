# flauz-memory

Flauz durable memory substrate (TL2-003, Worker C): the tiered memory under
`.flauz/memory/`, the retrieval index, the context compiler, and the
checkpoint/watermark/claims state family. Everything the Agent OS lane calls
"durable memory" lives here.

## What lives here (M2 - context compilation + retrieval)

- `src/retrieval.ts` - the PURE retrieval function over the memory index:
  deterministic ranking (scope-match +50, recency decay 2/day from +20, tag
  overlap +8/tag, kind weights authorization 10 .. evidence-ref 2, pin +4;
  ties break by id ascending), recorded ranking rules returned WITH the
  result, tier scope laws (other tasks' task/session memory invisible), and
  the private-context boundary (agent-scoped records readable only by the
  owner or through an effective grant share - enforced IN the pure function,
  so no consumer can bypass it). `effectiveShares()` derives the grant set
  from the share journal (last record wins).
- `src/context.ts` - the deterministic context compiler:
  - `ContextBudget` - the Worker B budget-seam shape, consumed as DATA
    (model id is a provenance label, never a branch; output tokens are
    reserved, never charged to input);
  - assembly priority: system/task-brief -> working memory -> task memory ->
    project memory -> resource fragments;
  - provenance preserved INTO the prompt - every line carries
    `[record MEM-id] [evidence E-id] [ref refId]` tags AND the structural
    `sections[].provenance` arrays;
  - truncation records: per-section caps first (`section-cap`), then the
    whole-context budget (`budget-exceeded`) dropping from the END of the
    lowest-priority section (resources -> project -> task -> working as last
    resort; the system preamble NEVER drops - a budget below the
    never-dropping core emits as-is with the accounting row showing it);
  - `contentHash` - sha256 over the canonical compilation: the determinism
    proof (same inputs -> same hash, byte-for-byte);
  - resource fragments carry the Workspace OS dimension - environment /
    browser-session descriptors arrive as fixture-shaped data
    (`test/fixtures/memory/descriptors/`), never as live TL3 dependencies.

## What lives here (M1 - tiered memory)

- `src/api.ts` - the `flauz.memory/v1` record shapes + strict validation:
  - tiers: `session` (the live task; scope taskId + agentId), `task`
    (persisted per task id), `project` (cross-task long-term);
  - record kinds: observation / instruction / summary / decision-ref /
    evidence-ref / authorization;
  - PROVENANCE on every record: actor, origin, contentHash (sha256 of the
    canonical content), ts, and the evidence row it derived from when
    applicable (`origin: 'ledger-row'` REQUIRES an E-NNNNNN evidenceId -
    no fabricated memory);
  - write-policy records (`promotions.jsonl`): promote / demote / compact /
    pin / unpin - explicit, recorded, exact-key-set validated;
  - share records (`shares.jsonl`): grant / revoke - the private-context
    boundary data for A2A (TL2-006);
  - the retrieval index envelope (`flauz.memory.index/v1`) with the journal
    registry (the FileSystemPort has no readdir - the workflows index.json
    pattern).
- `src/memory.ts` - `MemoryStore`: record / get / list / listAll / move /
  setPinned / compact / share / revokeShare / promotions / shares /
  rebuildIndex / verify.
- `src/format.ts` - the PU6 verbatim timestamp module (all 5 flauz copies are
  byte-identical; machine-checked by premium-ux-gate).
- `src/commands.ts` + `src/extension.ts` - the `flauz.memory.*` command
  surface (command activation ONLY - activation-lint R1-R3).

## Storage layout (workspace-local, DL-9 git-diffable)

```
.flauz/memory/
  session.jsonl        session/working tier journal (canonical-compact lines)
  tasks/T-NNN.jsonl    task tier journals (one per task id)
  project.jsonl        project/long-term tier journal
  promotions.jsonl     the write-policy log (promote/demote/compact/pin)
  shares.jsonl         cross-agent share records
  index.json           the retrieval index (entries derived + journal registry)
```

## The id law

Record ids are journal-scoped: `MEM-<journalId>-<NNNNNN>` where journalId is
`S` (session), `P` (project) or a task id. The sequence is minted from the
journal's max seq + 1 at append time. Compaction rewrites create gaps - the
law is UNIQUENESS within the journal plus the id/journal scope law, not
line-position contiguity.

## Write policies (explicit, recorded, human-gated where authorization lives)

- `move(recordId, toTier, {reason, actor, humanApproved})`: appends the minted
  record to the target journal, removes the source row, and appends the
  promotion row. `session -> task` and `-> project` are promotes; moves down
  are demotes. Moving an `authorization`-bearing record REQUIRES
  `humanApproved: true` with actor `human` - authorization-bearing state never
  auto-promotes (the hard rule).
- `compact(journal)`: retention pass - evicts oldest-first unpinned
  non-authorization records until within the cap (defaults: session 200 /
  task 500 / project 2000; injectable). The compact promotion row lists every
  dropped id - the audit trail of the only sanctioned journal rewrite.
- A retention pass that CANNOT recover (everything pinned/authorization) never
  fails the record() caller post-write; `verify()` reports the over-cap
  journal as a problem row instead (data preservation beats the cap, loudly).

## verify() verdict classes

1. journal line does not parse / fails validation;
2. id/journal scope violation, duplicate ids;
3. provenance.contentHash does not equal sha256(content) (post-facto mutation);
4. index parity: persisted entries/journals != rebuilt from journals (crash
   mid-append, drift) - `rebuildIndex()` restores parity;
5. over-cap journal that compaction cannot recover;
6. promotions/shares journal lines failing validation.

## Conventions

- Zero runtime dependencies; node >= 20 stdlib only in tests/extension wiring;
  the `src/` core (minus `extension.ts`) is node-free (FileSystemPort/Clock).
- Canonical serialization (DL-9): journals are canonical-compact JSON lines;
  `index.json` is sorted-key 2-space-indent with one trailing newline.
- Tests: `node --test test/*.test.ts` (node type-stripping; no build step).
- Typecheck: `npm run typecheck` (tsc --noEmit, standalone tsconfig, no
  @types/node - `shims/node.d.ts` carries the minimal ambient surface).
- Fixtures: `test/fixtures/memory/` (repo root), generated by
  `test/generateMemoryFixtures.ts` (deterministic, byte-identical regen);
  consumed by `test/fixtures.test.ts` with an expected-rule map.

## Verification

```
npm run typecheck          # tsc --noEmit (strict)
npm test                   # node --test test/*.test.ts
```

## v0 non-goals (M1/M2 scope)

No embeddings/vector retrieval (ranking is deterministic and recorded), no
cross-workspace service persistence yet (ARCHITECTURE-LOCK persistence layer
2), no LLM-in-the-loop summarization of memories (records are real events,
not generated content), no vendor tokenizer (estimateTokens is the single
token accounting function; budgets arrive as data through the seam).
