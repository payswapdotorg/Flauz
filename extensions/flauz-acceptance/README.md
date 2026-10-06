# Flauz Acceptance (A-PROD-006-W2, DL-87)

The launch + post-release-acceptance plane: the machinery that makes the
incidents loop's last two stages REAL -- the `regression -> release`
transition's `release-identity` evidence (`flauz.acceptance.launch`) and the
`release -> post-release-verification` closure's
`post-release-verification-receipt` evidence (`flauz.acceptance.verify`).

- `flauz.acceptance.launch` -- the launch-act law (fail-closed): mints a
  release-acceptance record ONLY over a GREEN, FRESH
  `flauz.release.checklist` artifact; typed refusals on red/absent/torn/
  stale. Record: `.flauz/acceptance/acceptance-<flauz:acc:<16-hex>>.json`
  (`flauz.acceptance/v1`), census-visible, swept + banked
  (taskId `flauz-acceptance`).
- `flauz.acceptance.verify` -- the post-release-acceptance law: re-runs the
  named owning checks against the released state and banks the closing
  receipt (pass or FAIL, both typed, both banked). A FAILED receipt is the
  typed failure record the incidents reopen law consumes. A check this
  plane cannot itself evaluate is a TYPED DISCLOSURE row naming its owning
  surface, never a silent green.

## Laws

- The gate vocabulary does NOT grow: the eleven prove-items stay verbatim;
  the verdict is READ from the checklist artifacts, never redefined.
- The two-registry separation: acceptance records NEVER mint registry
  items; WORK-REGISTRY.md stays the control plane.
- Determinism: the injected clock is the only timestamp source; the ids are
  fnv1a32-style deterministic derivations from record content (no random).
- Fail-closed: typed refusals over silent defaults, each carrying a reason.
- `src/format.ts` is the PU6-pinned byte-identical shared timestamp module
  (machine-checked against every flauz extension's copy).
- The siblings (`extensions/flauz-release/**`,
  `extensions/flauz-incidents/**`) are READ through contract-pinned
  parsers; their source is untouched.

## Honest scope

This plane delivers MACHINERY over workspace state; production usage is
EMPTY by design -- the launch has not happened. No acceptance record or
receipt may claim production-real evidence; the receipt's evidence label
for evaluable rows is `local-real` and is never promoted by wording.

## Module index

`src/extension.ts` (command-only activation, the W1 pattern),
`src/commands.ts` (the two commands, port-injected deps),
`src/acceptance.ts` (the launch-act law + record minting + the
product-state/census pins), `src/verify.ts` (the closing receipt),
`src/api.ts` (the record contracts + the read-only sibling parsers + chain
hashes + the watermark), `src/ledger.ts` (census-visible banking with
watermark resync), `src/privacy.ts` (the secret-shape canary sweep),
`src/globals.ts` (ids, paths, frozen law strings), `src/format.ts`
(verbatim shared timestamp module), `shims/node.d.ts`,
`vscode-dts/vscode.d.ts`.

## The suite

`npm test` (mocha --ui tdd test/*.test.ts); typecheck: `npm run typecheck`
+ `npm run typecheck-tests`.
