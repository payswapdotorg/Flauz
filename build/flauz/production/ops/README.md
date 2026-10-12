# A-PROD-006-W7 production ops family

The typed PRODUCTION-REAL deployment and operations family for the
Flauz web distribution (Vercel hosting + Neon Postgres). The closed
honest-evidence vocabulary for production exchanges: the frozen
evidence labels (the production-real rung claimed ONLY for exchanges
against the LIVE production URL and the LIVE Neon database, never
promoted), the frozen evidence kinds, the typed production target
identity, the append-only evidence ledger, the fail-closed health
report, and the canonical serialization.

## Charter (the binding laws)

1. **THE HONEST-EVIDENCE LAW (the never-promoted law):** the evidence
   labels are the frozen `fixture` | `local-real` | `production-real`
   list, in the exact list order. `production-real` is claimed ONLY
   for exchanges against the LIVE production URL and the LIVE Neon
   database - never promoted. A `production-real` label recorded over
   a non-production target is the typed `label-target-mismatch`
   rejection (BOTH directions: a production-real label over a
   fixture/local target, AND a fixture/local label over a production
   target). Labels are DERIVED from the target's `expectedLabel`
   (which must agree with the URL class), never caller-supplied.

2. **THE NO-SECRET LAW:** no credential material anywhere in the
   vocabulary (no Vercel token, no Neon API key, no Neon connection
   string, not even masked fragments). The ops vocabulary cannot even
   NAME a secret. Secrets reach the runtime boundary ONLY through the
   serverless function's env at runtime (`DATABASE_URL` read by the
   deploy layer, never in the contract or kit module).

3. **THE FAIL-CLOSED LAW:** a dead or non-production endpoint is the
   typed refusal, never a fabricated green. The health report carries
   `dbConnectivity: 'refused'` or `'unknown'` on a dead DB, never
   `'connected'` without a real connection. The `healthCheck`
   default-refuses without a fetch port (no global fetch in shipped
   code).

4. **THE INJECTED-CLOCK LAW:** the kit never reads a clock. Every
   timestamp is a read of the caller-injected clock. No `Date.now`,
   no `Math.random`, no `process.env` in the contract or kit source
   (law comments excepted; the in-suite determinism greps pin this).

5. **THE APPEND-ONLY LEDGER LAW:** the production evidence ledger
   (Neon table) is append-only. Re-recording an id appends a NEW
   revision (revision N+1); nothing is edited or deleted; the reader
   discloses revision counts.

6. **THE SINGLE-VERSION LAW:** `PRODUCTION_OPS_VERSION = '1.0.0'` is
   declared ONCE in the contract module, re-carried by the kit; the
   battery pins both copies equal.

## Module map

```
build/flauz/production/ops/
  common/
    productionOpsContract.ts   the frozen vocabulary (labels, kinds, reasons, guards, serializer, DDL)
    productionOpsKit.ts        the deterministic kit (injected clock, rng, queryLike, fetchLike)
  test/
    common/
      productionOpsContract.test.ts   the contract battery (73 tests)
      productionOpsKit.test.ts        the kit battery (64 tests)
  tsconfig.json               byte-identical copy of the acceptance family's tsconfig
  README.md                   this file
```

The deployment surface (`build/flauz/production/deploy/**`) is the
sibling subtree: the Vercel serverless functions, the deployment
config, the workspace assembler, and the runbook. See
`../deploy/README.md` for the build-assemble-deploy command ladder.

## The deployment runbook cross-link

The full production deployment runbook (the build-assemble-Neon-Vercel
command ladder with the receipts protocol) is in
[`../deploy/README.md`](../deploy/README.md). This family provides the
vocabulary and the kit; the deploy family provides the runtime seam
(the serverless functions that wire the kit with the real Neon driver
and read `DATABASE_URL` from the function env at runtime).

## Verification receipts

| receipt | command | expected |
|---|---|---|
| ops battery (contract) | `bunx --bun mocha --ui tdd 'build/flauz/production/ops/test/common/productionOpsContract.test.ts'` | 73 passing, 0 failing |
| ops battery (kit) | `bunx --bun mocha --ui tdd 'build/flauz/production/ops/test/common/productionOpsKit.test.ts'` | 64 passing, 0 failing |
| ops battery (full) | `bunx --bun mocha --ui tdd 'build/flauz/production/ops/test/common/*.test.ts'` | 137 passing, 0 failing |
| type check | `bunx tsc -p build/flauz/production/ops/tsconfig.json --noEmit` | 0 errors |
| sibling regression | `bunx --bun mocha --ui tdd 'build/flauz/inference/acceptance/test/common/*.test.ts'` | 180 passing, 0 failing |
| tsconfig parity | `sha256sum build/flauz/inference/acceptance/tsconfig.json build/flauz/production/ops/tsconfig.json` | MATCH (bb8d0745...) |
| determinism greps | the in-suite determinism grep tests (2 per file, 4 total) | all hits are law-comment lines |

## The frozen vocabularies

- `PRODUCTION_OPS_VERSION = '1.0.0'`
- `PRODUCTION_EVIDENCE_LABELS = ['fixture', 'local-real', 'production-real']`
- `PRODUCTION_EVIDENCE_KINDS = ['deployment', 'smoke-run', 'rollback-drill', 'incident-record', 'verification']`
- `PRODUCTION_REJECTION_REASONS = ['malformed-payload', 'caller-supplied-label', 'unknown-kind', 'label-target-mismatch', 'ledger-io', 'schema-io', 'non-production-target']`
- `PRODUCTION_URL_CLASSES = ['fixture', 'local', 'production']`

## The ledger schema (the idempotent DDL)

```sql
CREATE TABLE IF NOT EXISTS production_evidence (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    label TEXT NOT NULL,
    payload JSONB NOT NULL,
    recorded_at TEXT NOT NULL,
    revision INTEGER NOT NULL DEFAULT 1
);
```

The `id` is the primary key; re-recording an id UPSERTs the row
(incrementing the revision counter - the append-only law's revision
disclosure). The reader discloses the per-id revision counts.
