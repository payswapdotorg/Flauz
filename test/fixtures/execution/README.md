# Execution fixtures (test/fixtures/execution/)

The fixture matrix consumed by `extensions/flauz-execution/test/journal.test.ts`
(and the shape pinning in contracts.test.ts). These pin the TL2-S2 additive
sibling envelope `flauz.execution-journal/v0` (cross-worker contract;
consumers read-only):

- `journal.jsonl` rows: exactly 15 fields per row -
  `{$schema, seq, ts, rowId, graphId, stepId, attempt, idempotencyKey,
  acquisitionId, type, actor, origin, payload, contentHash, prev}`.
- One canonical JSON object per line (byte form: the repo canonicalJson
  discipline - recursively sorted keys, no insignificant whitespace - plus
  exactly one `\n`).
- Hash chain: each row's `prev` carries the previous row's full-row hash
  (sha256 over the canonical row minus prev; seq 1 has prev null).
  `contentHash` is the sha256 of the canonical payload.
- Row ids `X-NNNNNN`; acquisition ids `flauz:exec:<16-hex>` (logical ids,
  never paths/URLs/CDP target ids/pids).

## The good matrix (good/)

`good/journal.jsonl` pins a full lifecycle (byte-pinned through the real
store with a deterministic clock + minter):

1. browser acquisition: resource-acquired -> handoff-recorded ->
   effect-settled(ok) -> resource-released(completion);
2. environment acquisition with the task-step lease reference
   (L-NNN-NN-N) -> handoff -> resource-lost (executor-death, the churn
   state the M4 continuity restore rebinds);
3. logical-resource acquisition -> handoff (still held).

## The bad matrix (bad/) - one violation per file

| file | violation |
| --- | --- |
| 01-bad-schema.jsonl | wrong $schema |
| 02-unknown-key.jsonl | unknown row key (envelope discipline) |
| 03-bad-rowid.jsonl | rowId not derived from seq |
| 04-bad-contenthash.jsonl | contentHash does not match the canonical payload |
| 05-bad-actor.jsonl | actor outside the closed vocabulary |
| 06-unknown-event.jsonl | unknown event type |
| 07-bad-acquisition-level.jsonl | aggregate event carrying an acquisitionId |
| 08-broken-chain.jsonl | prev does not carry the previous row hash |
| 09-non-canonical.jsonl | byte drift (unsorted key order) |
| 10-not-json.jsonl | a non-JSON line in the middle (the final-line torn-tail exception must not swallow it) |
| 11-bad-lease-id.jsonl | lease.leaseId not the orchestration L-NNN-NN-N shape |
| 12-illegal-transition.jsonl | release before acquire (transition order) |
| 13-bad-surface-digest.jsonl | hand-off surfaceDigest linkage broken |
| 14-bad-idempotency-key.jsonl | idempotencyKey outside the flauz-orch pattern |
