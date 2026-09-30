# P2-FIX-102 — the dedicated battery/session tsconfig receipts are vacuous (the inherited exclude excludes their own subjects)

Routed from: the TL2-ACC-1 rehearsal's candidate finding CF-J2
(`docs/FLAUZ-PROGRAM/acceptance/tl2-agent-domain-journey-evidence.md`),
formalized by P2-002 Worker A (journey runtime) during acceptance routing.

- **Observable behavior:** `extensions/flauz-workflow/tsconfig.agentos-battery.json`
  (and `tsconfig.session-battery.json`) extend the base `tsconfig.json` but
  do NOT override its `exclude` — and the base exclude lists exactly the
  files the dedicated configs include (`test/agentos-battery.test.ts`,
  `test/canaries/agentos-runtime.drill.ts`, `test/session-battery.test.ts`,
  `test/canaries/session-battery-runtime.drill.ts`). The receipt
  `(cd extensions/flauz-workflow && npx tsc --noEmit -p tsconfig.agentos-battery.json)`
  therefore compiles ONLY the ambient shims + `a2a.d.mts` — the battery suite
  itself is never typechecked by that command.
- **Evidence + runtime level:** local-real — `npx tsc --noEmit -p
  tsconfig.agentos-battery.json --listFiles` on the pinned base `7558680d`
  lists 62 program files (TypeScript libs + the five ambient declarations);
  `agentos-battery.test.ts` and the drill are absent. Exit code 0 with an
  empty subject set (vacuously green). Consequence: type-level drift in the
  battery suite is invisible (see P2-FIX-103), which weakens the instrument
  the completion claims rest on.
- **Owning domain:** control plane / test instrument.
- **Proposed contract change (if any):** the dedicated configs must override
  `"exclude": []` (or the base config must stop excluding files a child
  config explicitly includes) so the receipts actually compile their
  subjects.
- **Exact owning TL:** TL1 (the tsconfig wiring; the batteries' owner TL2
  supplies the intent).
- **Acceptance test:** `npx tsc --noEmit -p tsconfig.agentos-battery.json
  --listFiles` must list `test/agentos-battery.test.ts` (and the drill) in
  the program, and the compile must then actually surface any type-level
  drift.
- **Architecture-change requirement:** no (instrument correctness).
