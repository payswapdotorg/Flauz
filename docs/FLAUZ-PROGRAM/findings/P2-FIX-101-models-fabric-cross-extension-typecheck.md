# P2-FIX-101 — flauz-models fabric sources are not statically importable from a sibling extension's default tsconfig

Routed from: the TL2-ACC-1 rehearsal's candidate finding CF-J1
(`docs/FLAUZ-PROGRAM/acceptance/tl2-agent-domain-journey-evidence.md`),
formalized by P2-002 Worker A (journey runtime) during acceptance routing.

- **Observable behavior:** a `flauz-workflow` test that statically imports
  flauz-models src modules (`discovery/registry.ts`, `routing/store.ts`,
  `routing/policy.ts`) fails `npx tsc --noEmit` under the default tsconfig:
  `TS6133` (the default config's `noUnusedLocals: true` flags a pre-existing
  unused type import inside `flauz-models/src/routing/store.ts`) and
  `TS2304`/`TS2307` (the fabric's `contract/` + `adapters/` sources use
  `TextDecoder`, `AbortSignal` and `node:buffer`, which the flauz-workflow
  ambient shims do not declare). The same sources compile cleanly under
  flauz-models' OWN tsconfig — the mismatch is a config-surface seam, not a
  semantic defect.
- **Evidence + runtime level:** local-real — reproducible on the pinned base
  `7558680d`: add the three static imports to the TL2-ACC-1 journey test and
  run `(cd extensions/flauz-workflow && npx tsc --noEmit)`; the diagnostic
  list appears (errors across `../flauz-models/src/{adapters/common,
  contract/canonical, contract/ports, contract/types, routing/store}.ts`);
  remove them (the landed rehearsal's runtime-resolved dynamic import) and
  the receipt is clean. The P2-002 journey drill loads the same three modules
  at runtime (green, runtime-real behavior) — the gap is typecheck coverage
  of that import edge, not runtime behavior.
- **Owning domain:** model-fabric test surface + cross-extension tsconfig
  wiring.
- **Proposed contract change (if any):** either (a) make the flauz-models src
  surface compile under sibling-extension default configs (declare the ambient
  needs where the consumers live, or drop the unused import in
  `routing/store.ts`), or (b) sanction a dedicated additive cross-extension
  test tsconfig pattern (a new config + an exclude entry in the default
  config). Option (b) touches the control plane (out of bounds for a worker
  lane).
- **Exact owning TL:** TL2 (the flauz-models fabric sources) with TL1
  (the tsconfig wiring) — primary owner TL2.
- **Acceptance test:** `npx tsc --noEmit` in `extensions/flauz-workflow` with
  the journey test importing `ModelCapabilityRegistry`/`ModelRouter`/
  `listDecisions`/`DEFAULT_ROUTING_POLICY` statically must exit 0.
- **Architecture-change requirement:** no (test-surface/config only).
